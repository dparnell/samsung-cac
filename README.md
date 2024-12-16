What is this?
=============

This repo contains code to talk to the Samsung MIN-H02 WiFi airconditioner controller.
Before it can be used you will need to know the IP address of the controller and obtain a connection token.

One thing to note, as the Samsung MIN-H02 device uses a very old version of the TLS protocol it will be necessary to tell node to allow the use of the older protocol as it is disabled by default in modern versions of node.
Adding `--tls-min-v1.0` did the trick for me.

How to get a token?
===================

I obtained my token by other means, but something like the following should work after pressing the AP button on the box.

```typescript
import * as cac from "samsung-cac";

let c = new cac.Connection("192.168.1.134");

c.connect().then((conn) => {
  console.info("Connected. Requesting token...");
  conn.getToken().then((obj) => console.info(JSON.stringify(obj)));
});
```

See [here](https://github.com/dparnell/samsung-cac-fetch) for an example

Now what?
=========

You should now be able to control your airconditioner from typescript.

```typescript
import * as cac from "samsung-cac";

const my_token = "111111111-2222-X999-Y999-9999999999999";
let c = new cac.Connection("192.168.1.134");

c.connect().then((conn) => {
  console.info("Connected. Logging in...");
  conn.login(my_token).then((s) => {
    console.info("Logged in: " + s);
    conn.deviceList().then((devs) => {
      conn.deviceState(devs[0].duid).then((obj) => {
        console.info(JSON.stringify(obj));
        conn.controlDevice(devs[0].duid, {power: cac.PowerMode.On}).then((obj) => {
          console.info(JSON.stringify(obj));
        });
      });
    });
  });
});
```

There is also a [Homebridge](https://homebridge.io/) [plugin](https://github.com/dparnell/homebridge-samsung-cac) so you can also use that to control your air conditioner via Siri.
