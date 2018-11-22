What is this?
=============

This repo contains code to talk to the Samsung MIN-H02 WiFi airconditioner controller.
Before it can be used you will need to know the IP address of the controller and obtain a connection token.

How to get a token?
===================

I obtained my token by other means, but something like the following should work after pressing the AP button on the box.

```javascript
let c = new Connection("192.168.1.134");

c.connect().then((conn) => {
  console.info("Connected. Logging in...");
  conn.getToken().then((obj) => JSON.stringify(obj));
});
```

Now what?
=========

You should now be able to control your airconditioner from typescript.

```javascript
const my_token = "111111111-2222-X999-Y999-9999999999999";
let c = new Connection("192.168.1.134");

c.connect().then((conn) => {
  console.info("Connected. Logging in...");
  conn.login(my_token).then((s) => {
    console.info("Logged in: " + s);
    conn.deviceList().then((devs) => {
      conn.deviceState(devs[0].duid).then((obj) => {
        console.info(JSON.stringify(obj));
        conn.controlDevice(devs[0].duid, {power: PowerMode.On}).then((obj) => {
          console.info(JSON.stringify(obj));
        });
      });
    });
  });
});
```
