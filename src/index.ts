import * as net from "net";
import * as tls from "tls";
import {ConnectionOptions, TLSSocket} from "tls";
import * as xml2js from "xml2js";

export const VERSION = "1.0.0";

// for some reason the reported AC temperature is offset by 55C
const CURRENT_TEMP_FUDGE = 55;

const DEFAULT_PORT = 2878;
// TODO: work out which cipher actually works with the MIM-H02 box
const ANY_CIPHER = tls.getCiphers().join(":").toUpperCase();


export interface ILiteEvent<T> {
    on(handler: { (data?: T): void }) : void;
    off(handler: { (data?: T): void }) : void;
}

export class LiteEvent<T> implements ILiteEvent<T> {
    private handlers: { (data?: T): void; }[] = [];

    public on(handler: { (data?: T): void }) : void {
        this.handlers.push(handler);
    }

    public off(handler: { (data?: T): void }) : void {
        this.handlers = this.handlers.filter(h => h !== handler);
    }

    public trigger(data?: T) {
        this.handlers.slice(0).forEach(h => h(data));
    }

    public expose() : ILiteEvent<T> {
        return this;
    }
}

export enum FanMode {
    On = "On", Off = "Off", Unknown = "Unknown"
}

export enum OperationMode {
    Auto = "Auto", Cool = "Cool", Heat = "Heat", Dry = "Dry", Unknown = "Unknown"
}

export enum PowerMode {
    On = "On", Off = "Off", Unknown = "Unknown"
}


export enum FanSpeed {
    Auto = "Auto", Low = "Low", Mid = "Mid", High = "High", Turbo = "Turbo", Unknown = "Unknown"
}

export class Attr {
    ID?: string;
    Type?: string;
    Value?: string;
}

export class DeviceState {
    public fan?: FanMode;
    public operation?: OperationMode;
    public power?: PowerMode;
    public current_temp?: number;
    public target_temp?: number;
    public fan_speed?: FanSpeed;

    parseAttrs(attrs: [Attr]) {
        for(let attr of attrs) {
            // console.info(JSON.stringify(attr));

            if(attr.ID == "AC_FUN_TEMPNOW") {
                this.current_temp = Number(attr.Value) - CURRENT_TEMP_FUDGE;
            } else if(attr.ID == "AC_FUN_TEMPSET") {
                this.target_temp = Number(attr.Value);
            } else if(attr.ID == "AC_FUN_POWER") {
                this.power = attr.Value as PowerMode;
            } else if(attr.ID == "AC_FUN_OPMODE") {
                this.operation = attr.Value as OperationMode;
            } else if(attr.ID == "AC_FUN_WINDLEVEL") {
                this.fan_speed = attr.Value as FanSpeed;
            } else if(attr.ID == "AC_FUN_FAN") {
                this.fan = attr.Value as FanMode;
            }
        }
    }
}

export interface ControlOptions {
    power?: PowerMode;
    op?: OperationMode;
    target_temp?: number;
    fan_speed?: FanSpeed;
    fan_mode?: FanMode;
}

export class Device {
    public duid: string;
    public group: string;
    public model: string;
    public state: DeviceState;

    constructor(duid : string, group : string , model : string) {
        this.duid = duid;
        this.group = group;
        this.model = model;
        this.state = new DeviceState();
    }
}

export class DeviceUpdated {
    connection: Connection;
    device: Device;
    atts: [Attr];

    constructor(connection: Connection, device: Device, atts: [Attr]) {
        this.connection = connection;
        this.device = device;
        this.atts = atts;
    }
}

export class Connection {
    private readonly onDisconnect = new LiteEvent<Connection>();
    private readonly onUpdate = new LiteEvent<DeviceUpdated>();

    hostname: string;
    port: number;

    stream?: TLSSocket;
    incoming: string;

    devices?: [Device];

    resolve_current_request?: (obj: any) => any;
    reject_current_request?: (obj: any) => any;

    public debug_log?:(msg: string) => void;

    public get Disconnected() { return this.onDisconnect.expose(); }
    public get DeviceUpdated() { return this.onUpdate.expose(); }

    constructor(hostname : string, port : number = DEFAULT_PORT) {
        this.hostname = hostname;
        this.port = port;
        this.incoming = "";
    }

    public disconnect(): void {
        if(this.stream) {
            // this.stream.disconnect();
            this.stream = undefined;
        }
    }

    private log(msg: string): void {
        if(this.debug_log) {
            this.debug_log(msg);
        }
    }

    public connect(): Promise<Connection> {
        return new Promise((resolve, reject) => {
            try {
                this.stream = tls.connect({host: this.hostname, port: this.port, rejectUnauthorized: false, ciphers: ANY_CIPHER});
                let invalidated = false;
                this.stream.on("data", (data) => {
                    this.incoming += data.toString();

                    let eolIndex;
                    while((eolIndex = this.incoming.indexOf("\n")) >= 0) {
                        const line = this.incoming.slice(0, eolIndex + 1).trim();
                        this.incoming = this.incoming.slice(eolIndex + 1);
                        this.log("RX: " + line);
                        if(line.startsWith("<")) {
                            xml2js.parseString(line, (err, obj) => {
                                if(err) {
                                    if(this.reject_current_request) {
                                        this.reject_current_request(err);
                                    }
                                } else {
                                    if(obj.Update) {
                                        if(!invalidated && obj.Update.$.Type == "InvalidateAccount") {
                                            // we have received the InvalidateAccount update so the unit is ready to talk to us
                                            invalidated = true;
                                            resolve(this);
                                        } else if(obj.Update.$.Type == "GetToken") {
                                            if(this.resolve_current_request) {
                                                this.resolve_current_request(obj);
                                            }
                                        } else {
                                            let dev = this.findDevice(obj.Update.Status[0].$.DUID);

                                            if(dev) {
                                                let atts = obj.Update.Status[0].Attr.map((a: any) => a.$);
                                                dev.state.parseAttrs(atts);
                                                // console.info(JSON.stringify(dev));
                                                this.onUpdate.trigger(new DeviceUpdated(this, dev, atts));
                                            } else {
                                                console.warn(JSON.stringify(obj));
                                            }
                                        }
                                    } else if(obj.Response && obj.Response.$.Type != "GetToken") {
                                        if(this.resolve_current_request) {
                                            this.resolve_current_request(obj);
                                        }
                                    }
                                }
                            });
                        }
                    }
                });
                this.stream.on("close", () => this.onDisconnect.trigger(this) );
                this.stream.on("error", (error) => console.error(error));
            } catch {
                reject();
            }
        });
    }

    send(req : any): Promise<any> {
        if(this.debug_log) {
            this.debug_log("REQUEST: " + JSON.stringify(req));
        }
        let builder = new xml2js.Builder({renderOpts: {pretty: false}});
        let xml = builder.buildObject(req) + "\r\n";
        if(this.debug_log) {
            this.debug_log("TX: " + xml);
        }
        this.stream!.write(xml);

        return new Promise((resolve, reject) => {
            this.resolve_current_request = resolve;
            this.reject_current_request = reject;
        });
    }

    public getToken(): Promise<String> {
        return new Promise((resolve, reject) => {
            let req = {
                "Request": {
                    "$": {"Type": "GetToken"},
                }
            };

            this.send(req).then((obj) => {
                resolve(obj.Update.$.Token);
            });
        });
    }

    public login(token: String): Promise<String> {
        return new Promise((resolve, reject) => {
            let req = {
                "Request": {
                    "$": {"Type": "AuthToken"},
                    "User": {"$": {"Token": token}}
                }
            };

            this.send(req).then((obj) => {
                resolve(obj.Response.$.StartFrom);
            });
        });
    }

    public deviceList(start: number = 1, count: number = 1, group: string = "ALL"): Promise<[Device]> {
        return new Promise((resolve, reject) => {
            let req = {
                "Request": {
                    "$": {
                        "Type": "DeviceList",
                        "StartNum": start,
                        "Count": count,
                        "GroupID": group
                    }
                }
            };

            this.send(req).then((obj) => {
                this.devices = obj.Response.DeviceList[0].Device.map((dev: any) => new Device(dev.$.DUID, dev.$.GroupID, dev.$.ModelID));
                resolve(this.devices);
            });
        });
    }

    public findDevice(duid: string): Device | undefined {
        return this.devices!.find((dev) => dev.duid == duid);
    }

    public deviceState(duid: string) : Promise<Device> {
        return new Promise((resolve, reject) => {
            let req = {
                "Request": {
                    "$": {
                        "Type": "DeviceState",
                        "DUID": duid
                    }
                }
            };

            this.send(req).then((obj) => {
                let dev = this.findDevice(obj.Response.DeviceState[0].Device[0].$.DUID);
                if(dev) {
                    let atts = obj.Response.DeviceState[0].Device[0].Attr.map((a: any) => a.$ as Attr);
                    dev.state.parseAttrs(atts);
                    this.onUpdate.trigger(new DeviceUpdated(this, dev, atts));
                    resolve(dev);
                } else {
                    reject("Unknown device: " + obj.Response.DeviceState[0].Device[0].$.DUID);
                }
            });

        });
    }

    public controlDevice(duid: string, {power, op, target_temp, fan_speed, fan_mode}: ControlOptions): Promise<any> {
        return new Promise((resolve, reject) => {
            let attrs = [];

            if(power) {
                attrs.push({"$": { "ID": "AC_FUN_POWER", "Value": power}});
            }
            if(op) {
                attrs.push({"$": { "ID": "AC_FUN_OPMODE", "Value": op}});
            }
            if(target_temp) {
                attrs.push({"$": { "ID": "AC_FUN_TEMPSET", "Value": target_temp}});
            }
            if(fan_speed) {
                attrs.push({"$": { "ID": "AC_FUN_WINDLEVEL", "Value": fan_speed}});
            }
            if(fan_mode) {
                attrs.push({"$": { "ID": "AC_FUN_FAN", "Value": fan_mode}});
            }

            let req = {
                "Request": {
                    "$": {
                        "Type": "DeviceControl"
                    },
                    "Control": {
                        "$": {
                            "CommandID": "cmd00000",
                            "DUID": duid
                        },
                        "Attr": attrs
                    }
                }
            };

            this.send(req).then((obj) => {
                resolve(obj);
            });
        });

    }
}
