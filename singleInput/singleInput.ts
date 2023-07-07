import { Data, DataElement } from '@decthings/api-client'
import * as NodeRed from 'node-red'

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
    'binary',
    'image/png',
    'image/jpg',
    'audio/mp3',
    'audio/wav',
    'video/mp4'
] as const

type DataType = (typeof types)[any]

interface SingleInputNodeDef extends NodeRed.NodeDef {
    dataType: DataType
    parameterName: string
}

const nodeInit: NodeRed.NodeInitializer = (RED): void => {
    function SingleInputNodeConstructor(this: NodeRed.Node, config: SingleInputNodeDef) {
        RED.nodes.createNode(this, config)

        this.on('input', async (msg, send, done) => {
            const msgDotDataType: string = (msg as any).dataType
            const msgDotParameterName: string = (msg as any).parameterName
            const dataTypeToUse = msgDotDataType || config.dataType
            const parameterNameToUse = msgDotParameterName || config.parameterName

            if (!dataTypeToUse) {
                this.status({ fill: 'red', shape: 'dot', text: 'Data type not specified' })
                done(new Error('Data type not specified'))
                return
            }
            if (!parameterNameToUse) {
                this.status({ fill: 'red', shape: 'dot', text: 'Parameter name not specified' })
                done(new Error('Parameter name not specified'))
                return
            }
            let element: DataElement
            try {
                if (dataTypeToUse === 'f32') {
                    element = DataElement.f32(msg.payload as number)
                } else if (dataTypeToUse === 'f64') {
                    element = DataElement.f64(msg.payload as number)
                } else if (dataTypeToUse === 'i8') {
                    element = DataElement.i8(msg.payload as number)
                } else if (dataTypeToUse === 'i16') {
                    element = DataElement.i16(msg.payload as number)
                } else if (dataTypeToUse === 'i32') {
                    element = DataElement.i32(msg.payload as number)
                } else if (dataTypeToUse === 'i64') {
                    element = DataElement.i64(msg.payload as number)
                } else if (dataTypeToUse === 'u8') {
                    element = DataElement.u8(msg.payload as number)
                } else if (dataTypeToUse === 'u16') {
                    element = DataElement.u16(msg.payload as number)
                } else if (dataTypeToUse === 'u32') {
                    element = DataElement.u32(msg.payload as number)
                } else if (dataTypeToUse === 'u64') {
                    element = DataElement.u64(msg.payload as number)
                } else if (dataTypeToUse === 'string') {
                    element = DataElement.string(msg.payload as string)
                } else if (dataTypeToUse === 'boolean') {
                    element = DataElement.boolean(msg.payload as boolean)
                } else if (dataTypeToUse === 'binary') {
                    element = DataElement.binary(msg.payload as Buffer)
                } else if (dataTypeToUse === 'image/png') {
                    element = DataElement.image('png', msg.payload as Buffer)
                } else if (dataTypeToUse === 'image/jpg') {
                    element = DataElement.image('jpg', msg.payload as Buffer)
                } else if (dataTypeToUse === 'audio/mp3') {
                    element = DataElement.audio('mp3', msg.payload as Buffer)
                } else if (dataTypeToUse === 'audio/wav') {
                    element = DataElement.audio('wav', msg.payload as Buffer)
                } else if (dataTypeToUse === 'video/mp4') {
                    element = DataElement.video('mp4', msg.payload as Buffer)
                } else {
                    done(new Error(`Invalid data type. Expected one of ["${types.join('", "')}]"`))
                    return
                }
            } catch (e) {
                done(e)
                return
            }
            send({ payload: [{ name: parameterNameToUse, data: new Data([element]) }] })
            done()
        })
    }

    RED.nodes.registerType('decthings-single-input', SingleInputNodeConstructor)
}

export = nodeInit
