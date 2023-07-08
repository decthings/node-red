import { DecthingsClient, DecthingsClientError, DecthingsClientInvalidRequestError } from '@decthings/api-client'
import { DatasetRpc } from '@decthings/api-client/dist/Rpc'
import * as NodeRed from 'node-red'
import * as uuid from 'uuid'

interface AddToDatasetNodeDef extends NodeRed.NodeDef {
    datasetId?: string
    needsReview?: boolean
    apiKey?: string
}

class DecthingsAddToDatasetError extends Error {
    constructor(public inner: Awaited<ReturnType<DatasetRpc['addEntries']>>['error']) {
        super(`The Decthings addEntries call failed, with error: ${inner.code}${inner.code === 'invalid_parameter' ? ` - ${inner.reason}` : ''}`)
    }
}

class DecthingsAddToDatasetNeedsReviewError extends Error {
    constructor(public inner: Awaited<ReturnType<DatasetRpc['addEntriesToNeedsReview']>>['error']) {
        super(`The Decthings addEntriesToNeedsReview call failed, with error: ${inner.code}${inner.code === 'invalid_parameter' ? ` - ${inner.reason}` : ''}`)
    }
}

const nodeInit: NodeRed.NodeInitializer = (RED): void => {
    function AddToDatasetNodeConstructor(this: NodeRed.Node, config: AddToDatasetNodeDef) {
        const node = this
        RED.nodes.createNode(node, config)

        if (config.datasetId) {
            node.status({ fill: 'blue', shape: 'dot', text: `Looking for dataset..` })
        }

        const decthingsClient = new DecthingsClient({ apiKey: config.apiKey })

        let adding = false

        let name: string
        let fetchingName = false
        let doNotTryFetchNameAgain = false
        async function tryGetDatasetName() {
            if (doNotTryFetchNameAgain || name || fetchingName || !config.datasetId) {
                return
            }
            try {
                fetchingName = true
                decthingsClient.setApiKey(config.apiKey)
                const datasets = await decthingsClient.dataset.getDatasets({ datasetIds: [config.datasetId] })
                if (datasets.error) {
                    if (datasets.error.code === 'bad_credentials') {
                        doNotTryFetchNameAgain = true
                    }
                    if (!adding) {
                        node.status({
                            fill: 'red',
                            shape: 'dot',
                            text: `Error contacting Decthings: ${datasets.error.code === 'bad_credentials' ? 'Bad API key' : datasets.error.code}`
                        })
                    }
                } else {
                    const dataset = datasets.result.datasets.find((x) => x.id == config.datasetId)
                    if (dataset) {
                        name = dataset.name
                        if (dataset.access !== 'readwrite') {
                            if (!adding) {
                                node.status({ fill: 'red', shape: 'dot', text: `You do not have write access to dataset "${name}"` })
                            }
                        } else {
                            if (!adding) {
                                node.status({ fill: 'green', shape: 'dot', text: `Ready to add data to "${name}"` })
                            }
                        }
                    } else {
                        doNotTryFetchNameAgain = true
                        if (!adding) {
                            if (uuid.validate(config.datasetId)) {
                                if (config.apiKey) {
                                    node.status({
                                        fill: 'red',
                                        shape: 'dot',
                                        text: `Dataset not found.`
                                    })
                                } else {
                                    // The API key may be included in the msg.apiKey field, so dataset may in fact exist
                                    node.status({ fill: 'green', shape: 'dot', text: 'Ready to add data' })
                                }
                            } else {
                                node.status({
                                    fill: 'red',
                                    shape: 'dot',
                                    text: `Dataset not found. Use the dataset ID, not the name.`
                                })
                            }
                        }
                    }
                }
            } catch (e) {
                if (!adding) {
                    node.status({ fill: 'red', shape: 'dot', text: `Failed to communicate with Decthings` })
                }
            } finally {
                fetchingName = false
            }
        }
        tryGetDatasetName()

        node.on('input', async (msg, send: any, done) => {
            if (Array.isArray(msg.payload) && msg.payload.length === 0) {
                done(new Error("Got zero elements to add"))
                return
            }

            const msgDotDatasetId: string = (msg as any).datasetId
            const msgDotNeedsReview: boolean = (msg as any).needsReview
            const msgDotApiKey: string = (msg as any).apiKey
            const datasetIdToUse = msgDotDatasetId || config.datasetId
            const needsReviewToUse =
                typeof msgDotNeedsReview === 'boolean' ? msgDotNeedsReview : typeof config.needsReview === 'boolean' ? config.needsReview : true
            const apiKeyToUse = msgDotApiKey || config.apiKey

            if (!datasetIdToUse) {
                node.status({ fill: 'red', shape: 'dot', text: 'No dataset specified' })
                done(new Error('No dataset specified'))
                return
            }

            decthingsClient.setApiKey(apiKeyToUse)

            adding = true
            node.status({ fill: 'blue', shape: 'ring', text: 'Adding data..' })
            try {
                let result: Awaited<ReturnType<DatasetRpc['addEntries']>> | Awaited<ReturnType<DatasetRpc['addEntriesToNeedsReview']>>
                if (needsReviewToUse) {
                    result = await decthingsClient.dataset.addEntriesToNeedsReview({
                        datasetId: datasetIdToUse,
                        entries: msg.payload as any
                    })
                } else {
                    result = await decthingsClient.dataset.addEntries({
                        datasetId: datasetIdToUse,
                        entries: msg.payload as any
                    })
                }
                if (result.error) {
                    node.status({
                        fill: 'red',
                        shape: 'dot',
                        text: `Add data failed: ${result.error.code === 'dataset_not_found' ? 'Dataset not found' : result.error.code}`
                    })
                    if (needsReviewToUse) {
                        done(new DecthingsAddToDatasetNeedsReviewError(result.error))
                    } else {
                        done(new DecthingsAddToDatasetError(result.error))
                    }
                } else {
                    if (name) {
                        node.status({ fill: 'green', shape: 'dot', text: `Ready to add data to "${name}"` })
                    } else {
                        tryGetDatasetName()
                        node.status({ fill: 'green', shape: 'dot', text: 'Ready to add data' })
                    }
                    send({ payload: result.result })
                    done()
                }
            } catch (e) {
                if (e instanceof DecthingsClientError) {
                    if (e instanceof DecthingsClientInvalidRequestError) {
                        node.status({ fill: 'red', shape: 'dot', text: `Failed to add data: Invalid input` })
                    } else {
                        node.status({ fill: 'red', shape: 'dot', text: `Failed to communicate with Decthings` })
                    }
                } else {
                    node.status({ fill: 'red', shape: 'dot', text: `Failed to add data` })
                }
                done(e)
            }
            adding = false
        })
    }

    RED.nodes.registerType('decthings-add-to-dataset', AddToDatasetNodeConstructor)
}

export = nodeInit
