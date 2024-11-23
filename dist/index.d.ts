/// <reference types="node" />
import { Duplex } from "stream";
export declare const VERSION = "1.0.8";
export interface ILiteEvent<T> {
    on(handler: {
        (data?: T): void;
    }): void;
    off(handler: {
        (data?: T): void;
    }): void;
}
export declare class LiteEvent<T> implements ILiteEvent<T> {
    private handlers;
    on(handler: {
        (data?: T, extra?: any): void;
    }): void;
    off(handler: {
        (data?: T, extra?: any): void;
    }): void;
    trigger(data?: T, extra?: any): void;
    expose(): ILiteEvent<T>;
}
export declare enum FanMode {
    On = "On",
    Off = "Off",
    Unknown = "Unknown"
}
export declare enum OperationMode {
    Auto = "Auto",
    Cool = "Cool",
    Heat = "Heat",
    Dry = "Dry",
    Unknown = "Unknown"
}
export declare enum PowerMode {
    On = "On",
    Off = "Off",
    Unknown = "Unknown"
}
export declare enum FanSpeed {
    Auto = "Auto",
    Low = "Low",
    Mid = "Mid",
    High = "High",
    Turbo = "Turbo",
    Unknown = "Unknown"
}
export declare class Attr {
    ID?: string;
    Type?: string;
    Value?: string;
}
export declare class DeviceState {
    fan?: FanMode;
    operation?: OperationMode;
    power?: PowerMode;
    current_temp?: number;
    target_temp?: number;
    fan_speed?: FanSpeed;
    parseAttrs(attrs: [Attr]): void;
}
export interface ControlOptions {
    power?: PowerMode;
    op?: OperationMode;
    target_temp?: number;
    fan_speed?: FanSpeed;
    fan_mode?: FanMode;
}
export declare class Device {
    duid: string;
    group: string;
    model: string;
    state: DeviceState;
    constructor(duid: string, group: string, model: string);
}
export declare class DeviceUpdated {
    connection: Connection;
    device: Device;
    atts: [Attr];
    constructor(connection: Connection, device: Device, atts: [Attr]);
}
export interface TLSSocketFactory {
    (host: string, port: number): Duplex;
}
export declare class Connection {
    private readonly onDisconnect;
    private readonly onError;
    private readonly onUpdate;
    hostname: string;
    port: number;
    stream?: Duplex;
    incoming: string;
    devices?: [Device];
    resolve_current_request?: (obj: any) => any;
    reject_current_request?: (obj: any) => any;
    debug_log?: (msg: string) => void;
    readonly Disconnected: ILiteEvent<Connection>;
    readonly Error: ILiteEvent<Connection>;
    readonly DeviceUpdated: ILiteEvent<DeviceUpdated>;
    constructor(hostname: string, port?: number);
    disconnect(): void;
    private log;
    connect(socketFactory?: TLSSocketFactory): Promise<Connection>;
    send(req: any): Promise<any>;
    getToken(): Promise<String>;
    login(token: String): Promise<String>;
    deviceList(start?: number, count?: number, group?: string): Promise<[Device]>;
    findDevice(duid: string): Device | undefined;
    deviceState(duid: string): Promise<Device>;
    controlDevice(duid: string, { power, op, target_temp, fan_speed, fan_mode }: ControlOptions): Promise<any>;
}
