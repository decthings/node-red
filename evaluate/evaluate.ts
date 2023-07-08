import { DecthingsClient, DecthingsClientError, DecthingsClientInvalidRequestError, FailedEvaluationResultDetails } from '@decthings/api-client'
import { ModelRpc } from '@decthings/api-client/dist/Rpc'
import * as NodeRed from 'node-red'
import * as uuid from 'uuid'

interface EvaluateNodeDef extends NodeRed.NodeDef {
    modelId: string
    snapshotId?: string
    apiKey?: string
}

class DecthingsEvaluateError extends Error {
    constructor(public inner: Awaited<ReturnType<ModelRpc['evaluate']>>['error']) {
        super(`The Decthings evaluation failed to start, with error: ${inner.code}${inner.code === 'invalid_parameter' ? ` - ${inner.reason}` : ''}`)
    }
}

class DecthingsEvaluateFailedError extends Error {
    constructor(public inner: Awaited<ReturnType<ModelRpc['evaluate']>>['result']['failed']) {
        const getFailedNodeError = (details: FailedEvaluationResultDetails): Extract<FailedEvaluationResultDetails, { modelType: 'code' }>['error'] => {
            if (details.modelType === 'code') {
                return details.error
            } else {
                for (const node of details.nodes) {
                    if (node.failed) {
                        return getFailedNodeError(node.failed)
                    }
                }
            }
        }

        const error = getFailedNodeError(inner.executionDetails)

        super(
            `The Decthings evaluation failed, with error: ${error.code === 'exception' ? 'Exception in model:' : error.code}${
                error.code === 'exception' && error.exceptionDetails ? `. Details:\n---\n${error.exceptionDetails}\n---` : ''
            }`
        )
    }
}

const nodeInit: NodeRed.NodeInitializer = (RED): void => {
    function EvaluateNodeConstructor(this: NodeRed.Node, config: EvaluateNodeDef) {
        const node = this
        RED.nodes.createNode(node, config)

        if (config.modelId) {
            node.status({ fill: 'blue', shape: 'dot', text: `Looking for model..` })
        }

        const decthingsClient = new DecthingsClient({ apiKey: config.apiKey })

        let evaluating = false

        let name: string
        let fetchingName = false
        let doNotTryFetchNameAgain = false
        async function tryGetModelName() {
            if (doNotTryFetchNameAgain || name || fetchingName || !config.modelId) {
                return
            }
            try {
                fetchingName = true
                decthingsClient.setApiKey(config.apiKey)
                const models = await decthingsClient.model.getModels({ modelIds: [config.modelId] })
                if (models.error) {
                    if (models.error.code === 'bad_credentials') {
                        doNotTryFetchNameAgain = true
                    }
                    if (!evaluating) {
                        node.status({
                            fill: 'red',
                            shape: 'dot',
                            text: `Error contacting Decthings: ${models.error.code === 'bad_credentials' ? 'Bad API key' : models.error.code}`
                        })
                    }
                } else {
                    const model = models.result.models.find((x) => x.id == config.modelId)
                    if (model) {
                        name = model.name
                        if (!evaluating) {
                            node.status({ fill: 'green', shape: 'dot', text: `Ready to evaluate "${name}"` })
                        }
                    } else {
                        doNotTryFetchNameAgain = true
                        if (!evaluating) {
                            if (uuid.validate(config.modelId)) {
                                if (config.apiKey) {
                                    node.status({
                                        fill: 'red',
                                        shape: 'dot',
                                        text: `Model not found.`
                                    })
                                } else {
                                    // The API key may be included in the msg.apiKey field, so model may in fact exist
                                    node.status({ fill: 'green', shape: 'dot', text: 'Ready to evaluate' })
                                }
                            } else {
                                node.status({
                                    fill: 'red',
                                    shape: 'dot',
                                    text: `Model not found. Use the model ID, not the name.`
                                })
                            }
                        }
                    }
                }
            } catch (e) {
                if (!evaluating) {
                    node.status({ fill: 'red', shape: 'dot', text: `Failed to communicate with Decthings` })
                }
            } finally {
                fetchingName = false
            }
        }
        tryGetModelName()

        node.on('input', async (msg, send: any, done) => {
            const msgDotModelId: string = (msg as any).modelId
            const msgDotSnapshotId: string = (msg as any).snapshotId
            const msgDotApiKey: string = (msg as any).apiKey
            const modelIdToUse = msgDotModelId || config.modelId
            const snapshotIdToUse = msgDotSnapshotId || config.snapshotId
            const apiKeyToUse = msgDotApiKey || config.apiKey

            if (!modelIdToUse) {
                node.status({ fill: 'red', shape: 'dot', text: 'No model specified' })
                done(new Error('No model specified'))
                return
            }

            decthingsClient.setApiKey(apiKeyToUse)

            evaluating = true
            node.status({ fill: 'blue', shape: 'ring', text: 'Evaluating..' })
            try {
                let result = await decthingsClient.model.evaluate({
                    modelId: modelIdToUse,
                    params: msg.payload as any,
                    snapshotId: snapshotIdToUse
                })
                if (result.error) {
                    node.status({
                        fill: 'red',
                        shape: 'dot',
                        text: `Evaluation failed to start: ${result.error.code === 'model_not_found' ? 'Model not found' : result.error.code}`
                    })
                    done(new DecthingsEvaluateError(result.error))
                } else if (result.result.failed) {
                    node.status({ fill: 'red', shape: 'dot', text: 'Evaluation failed' })
                    done(new DecthingsEvaluateFailedError(result.result.failed))
                } else {
                    if (name) {
                        node.status({ fill: 'green', shape: 'dot', text: `Ready to evaluate "${name}"` })
                    } else {
                        tryGetModelName()
                        node.status({ fill: 'green', shape: 'dot', text: 'Ready to evaluate' })
                    }
                    send({ payload: result.result.success.output, executionDetails: result.result.success.executionDetails })
                    done()
                }
            } catch (e) {
                if (e instanceof DecthingsClientError) {
                    if (e instanceof DecthingsClientInvalidRequestError) {
                        node.status({ fill: 'red', shape: 'dot', text: `Evaluation failed to start: Invalid input` })
                    } else {
                        node.status({ fill: 'red', shape: 'dot', text: `Failed to communicate with Decthings` })
                    }
                } else {
                    node.status({ fill: 'red', shape: 'dot', text: `Failed to evaluate` })
                }
                done(e)
            }
            evaluating = false
        })
    }

    RED.nodes.registerType('decthings-evaluate', EvaluateNodeConstructor)
}

export = nodeInit
