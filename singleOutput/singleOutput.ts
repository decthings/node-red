import { Data, DataElement } from '@decthings/api-client'
import * as NodeRed from 'node-red'

interface SingleOutputNodeDef extends NodeRed.NodeDef {}

const nodeInit: NodeRed.NodeInitializer = (RED): void => {
    function SingleOutputNodeConstructor(this: NodeRed.Node, config: SingleOutputNodeDef) {
        RED.nodes.createNode(this, config)

        this.on('input', async (msg, send: any, done) => {
            function scan(data: any, nesting: number): DataElement | null {
                if (data instanceof DataElement) {
                    return data
                }
                if (nesting === 0) {
                    return null
                }
                if (data instanceof Data) {
                    for (const child of data.values()) {
                        const res = scan(child, 1)
                        if (res) {
                            return res
                        }
                    }
                    return null
                }
                if (!data) {
                    return null
                }
                for (const key of Object.keys(data)) {
                    const child = data[key]
                    const res = scan(child, nesting - 1)
                    if (res) {
                        return res
                    }
                }
            }

            const element = scan(msg.payload, 5)

            if (!element) {
                done(new Error('No DataElement found in the payload.'))
                return
            }
            if (element.isDict()) {
                send({ payload: element.getDict(), type: element.type() })
                done()
                return
            }
            if (element.isNumber()) {
                send({ payload: element.getNumber(), type: element.type() })
                done()
                return
            }
            if (element.isString()) {
                send({ payload: element.getString(), type: element.type() })
                done()
                return
            }
            if (element.isBoolean()) {
                send({ payload: element.getBoolean(), type: element.type() })
                done()
                return
            }
            if (element.isBinary()) {
                send({ payload: element.getBinary(), type: element.type() })
                done()
                return
            }
            if (element.isImage()) {
                const { data, format } = element.getImage()
                send({ payload: data, format, type: element.type() })
                done()
                return
            }
            if (element.isAudio()) {
                const { data, format } = element.getAudio()
                send({ payload: data, format, type: element.type() })
                done()
                return
            }
            if (element.isVideo()) {
                const { data, format } = element.getVideo()
                send({ payload: data, format, type: element.type() })
                done()
                return
            }
        })
    }

    RED.nodes.registerType('decthings-single-output', SingleOutputNodeConstructor)
}

export = nodeInit
