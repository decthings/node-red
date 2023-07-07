import { DecthingsClient, DecthingsClientError, DecthingsClientInvalidRequestError, FailedEvaluationResultDetails } from '@decthings/api-client'
import { ModelRpc } from '@decthings/api-client/dist/Rpc'
import * as NodeRed from 'node-red'
import * as uuid from 'uuid'

const types = [
    'f32',
    'f64',
    'i8',
    'i16',
    'i32',
    'i64',
    'u8',
    'u16',
    'u32',
    'u64',
    'string',
    'boolean',
    'image/png',
    'image/jpg',
    'audio/mp3',
    'audio/wav',
    'video/mp4'
] as const

type DataType = (typeof types)[any]

interface EvaluateNodeDef extends NodeRed.NodeDef {
    modelId: string
    snapshotId?: string
    apiKey?: string
    convertInput: 'no' | DataType
}

class DecthingsEvaluateError extends Error {
    constructor(public inner: Awaited<ReturnType<ModelRpc['evaluate']>>['error']) {
        super(`The Decthings evaluation failed to start, with error: ${inner.code}`)
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
        } else {
            node.status({ fill: 'red', shape: 'dot', text: 'No model specified' })
        }

        const decthingsClient = new DecthingsClient({ apiKey: config.apiKey })

        let evaluating = false

        let name: string
        let fetchingName = false
        async function tryGetModelName() {
            if (name || fetchingName) {
                return
            }
            if (config.modelId) {
                try {
                    fetchingName = true
                    const models = await decthingsClient.model.getModels({ modelIds: [config.modelId] })
                    if (models.error) {
                        if (!evaluating) {
                            node.status({
                                fill: 'red',
                                shape: 'dot',
                                text: `Error contacting Decthings: ${models.error.code === 'bad_credentials' ? 'Bad API key' : models.error.code}`
                            })
                        }
                    } else {
                        const model = models.result.models.find((x) => x.id == config.modelId)
                        if (!model) {
                            if (uuid.validate(config.modelId)) {
                                node.status({
                                    fill: 'red',
                                    shape: 'dot',
                                    text: `Model not found${config.apiKey ? '' : '. Add an API key to use your own models.'}`
                                })
                            } else {
                                node.status({
                                    fill: 'red',
                                    shape: 'dot',
                                    text: `Model not found. Use the model ID, not the name.`
                                })
                            }
                        } else {
                            name = model.name
                            if (!evaluating) {
                                node.status({ fill: 'green', shape: 'dot', text: `Ready to evaluate "${name}"` })
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
        }

        tryGetModelName()

        node.on('input', async (msg, send: any, done) => {
            if (!config.modelId) {
                node.status({ fill: 'red', shape: 'dot', text: 'No model specified' })
                done(new Error('No model specified'))
                return
            }
            evaluating = true
            node.status({ fill: 'blue', shape: 'ring', text: 'Evaluating..' })
            try {
                let result = await decthingsClient.model.evaluate({
                    modelId: config.modelId,
                    params: msg.payload as any,
                    snapshotId: config.snapshotId || undefined
                })
                if (result.error) {
                    node.status({ fill: 'red', shape: 'dot', text: 'Evaluation failed to start' })
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
                tryGetModelName()
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
