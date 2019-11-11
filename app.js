const http = require('http');
const request = require('request');
const urlencode = require('urlencode');
const fs = require('fs');

const config_path = `${process.env.HOME}/.hubitat-maker-to-influxdb/config.json`;

var config_loaded = {}
if (fs.existsSync(config_path)) {
    console.log("Loading config: ", config_path);
    config_loaded = require(config_path);
}

var config = {
    local_config: {
        hostname:  '0.0.0.0',
        base_port: 8567,
        influxdb_port: 8086,
        influxdb_host: '127.0.0.1',
        influxdb_db_name: 'hubitatMaker',
        local_url: 'http://192.168.7.94',
        poll_interval: 1800,
    },
    hubs: {
    }
}

var hub_defaults = {
}

if (config_loaded.local_config)
    Object.assign(config.local_config, config_loaded.local_config);

if (config_loaded.hubs) {
    Object.keys(config_loaded.hubs).forEach((hubName) => {
        const conf_data = config_loaded.hubs[hubName];
        console.log("Hub: ", hubName, conf_data);
        config.hubs[hubName] = {};
        Object.assign(config.hubs[hubName], hub_defaults, conf_data);
    });
}

console.log("Config: ", config);

var port = config.local_config.base_port;
Object.keys(config.hubs).forEach((hubName) => {
    const hub = config.hubs[hubName];
    console.log("Creating instance for", hubName, "port:", port);
    instance(hubName, hub, port++);
});

function instance(hubName, hub, port) {

    var stats = {};
    var poll_timers = {};

    const local_url = `${config.local_config.local_url}:${port}/`;
    console.log(hubName, "local_url", local_url);
    const local_url_encoded = urlencode(local_url);
    console.log(hubName, "Local url encoded", local_url_encoded);

    const post_to = `${hub.url}/postURL/${local_url_encoded}?access_token=${hub.token}`;
    console.log(hubName, "post_to", post_to);

    const server = http.createServer((request, res) => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain');
        //console.log(hubName, 'url:', request.url);
        //console.log(hubName, 'headers:', request.headers);
        //console.log(hubName, 'method:', request.method);
        //console.log(hubName, 'statusCode', request.statusCode);
        var body = '';
        request.on('data', (data) => {
            body += data;
        });
        request.on('end', () => {
            //console.log(hubName, 'body:', body);
            const jsonParsed = JSON.parse(body);
            process_event(jsonParsed.content);
            res.end('Done!\n');
        });
    });

    server.listen(port, config.local_config.hostname, () => {
          console.log(hubName, `Server running at http://${config.local_config.hostname}:${port}/`);
          console.log(hubName, 'Calling Maker API with:', post_to);
          request(post_to, (error, responce, body) => {
              if (error) console.error('error:', error);
              console.log(hubName, 'statusCode:', responce && responce.statusCode);
              console.log(hubName, 'body:', body);
          });
    });

    function escapeStringForInfluxDB(string) {
        if (string) {
            string = string.replace(/ /g, "\\ "); // Escape spaces.
            string = string.replace(/,/g, "\\,"); // Escape commas.
            string = string.replace(/=/g, "\\="); // Escape equal signs.
            string = string.replace(/\"/g, "\\\""); // Escape double quotes.
        }
        else {
            string = 'null'
        }
        return string;
    }

    var postTimer;
    var postQueue = [];

    function postToInfluxDB(data) {
        postQueue.push(data);

        if (postTimer) return;

        postTimer = setTimeout( () => {
            const sendData = postQueue;
            postQueue = [];
            postTimer = null;

            var db_name = hub.influxdb_db_name;
            if (!db_name) db_name = config.local_config.influxdb_db_name;

            const options = {
                port: config.local_config.influxdb_port,
                host: config.local_config.influxdb_host,
                path: `/write?precision=ms&db=${db_name}`,
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'}
            };

            const req = http.request(options, (res) => {
                if (res.statusCode != 204) {
                    console.log(hubName, `STATUS: ${res.statusCode}`);
                    console.log(hubName, `HEADERS: ${JSON.stringify(res.headers)}`);
                }
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    console.log(hubName, `BODY: ${chunk}`);
                });
                res.on('end', () => {
                    //console.log(hubName, "Sent:", sendData.length);
                    //console.log(hubName, 'No more data in response.');
                });
            });

            req.on('error', (e) => {
                console.error(`problem with request: ${e.message}`);
            });

            req.write(sendData.join("\n"));
            req.end();
        }, 5000);
    }

    function hubDefaultBool(name, value, truth) {
        var unit = name;
        value = '"' + value + '"';
        var valueBinary = (truth == value) ? '0i' : '1i';
        return `,unit=${unit} value=${value},valueBinary=${valueBinary}`;
    }

    const boolTypes = {
        acceleration: { truth: 'active', },
        alarm: { thruth: 'off', },
        button: { truth: 'pushed', },
        carbonMonoxide: { truth: 'detected', },
        consumableStatus: { truth: 'good', },
        contact: { truth: 'closted', },
        door: { truth: 'closed', },
        lock: { truth: 'locked', },
        mode: { truth: 'Away', },
        motion: { truth: 'active', },
        mute: { truth: 'muted', },
        presence: { truth: 'present' },
        shock: { truth: 'detected', },
        sessionStatus: { truth: 'stop', },
        sleeping: { truth: 'sleeping', },
        smoke: { truth: 'detected', },
        sound: { truth: 'detected', },
        'switch': { truth: 'on', },
        tamper: { truth: 'detected', },
        thermostatMode: { truth: 'off', },
        thermostatFanMode: { truth: 'off', },
        thermostatOperatingState: { truth: 'heating', },
        thermostatSetpointMode: { truth: 'followSchedule', },
        touch: { truth: 'touched', },
        optimisation: { truth: 'active', },
        windowFunction: { truth: 'active', },
        touch: { truth: 'touched', },
        water: { truth: 'wet', },
        windowShade: { truth: 'closed', },
    };

    function process_event(evt, repeat) {
        console.log(hubName, 'json:', evt);

        if (!stats[evt.displayName]) stats[evt.displayName] = 0;
        stats[evt.displayName] += 1;
        stats._totalEvents += 1;
        
        var deviceId = evt.deviceId;
        if (!deviceId) deviceId = 0;

        const evt_uniq_string = `${deviceId}-${evt.name}`;
        console.log(hubName, 'evt_uniq_string', evt_uniq_string);
        if (poll_timers[evt_uniq_string]) clearTimeout(poll_timers[evt_uniq_string]);
        poll_timers[evt_uniq_string] = setTimeout(() => {
            // I don't know if clearTimeout on a timeout that's
            // being run could be bad, so perhaps is ok?
            poll_timers[evt_uniq_string] = null;
            process_event(evt, "repeat");
        }, config.local_config.poll_interval*1000); 

        // Build data string to send to InfluxDB:
        //  Format: <measurement>[,<tag_name>=<tag_value>] field=<field_value>
        //    If value is an integer, it must have a trailing "i"
        //    If value is a string, it must be enclosed in double quotes.
        var measurement = evt.name;
        // tags:
        var deviceId = escapeStringForInfluxDB(deviceId.toString());
        var unit = escapeStringForInfluxDB(evt.unit);
        var value = escapeStringForInfluxDB(evt.value);
        const deviceName = escapeStringForInfluxDB(evt.displayName);
        const hubNameEsc = escapeStringForInfluxDB(hubName);
        const hubId = escapeStringForInfluxDB(hub.hubId);
        const locationId = escapeStringForInfluxDB(hub.locationId);
        const locationName = escapeStringForInfluxDB(hub.locationName);
        const is_repeat = escapeStringForInfluxDB((repeat) ? 'true' : 'false');
        var valueBinary = '';
        
        var data = `${measurement},deviceId=${deviceId},deviceName=${deviceName},hubName=${hubNameEsc},hubId=${hubId},locationId=${locationId},locationName=${locationName},repeat=${is_repeat}`;

        if (boolTypes[evt.name]) {
            data += hubDefaultBool(evt.name, evt.value, boolTypes[evt.name].truth);
        }
        else if ('energyDuration' == evt.name) {
            unit = evt.value.split(" ")[1];
            value = evt.value.split(" ")[0];
            data += `,unit=${unit} value=${value}`
        }
        else if ('threeAxis' == evt.name) { // threeAxis: Format to x,y,z values.
            unit = 'threeAxis'
            var valueXYZ = evt.value.split(",");
            var valueX = valueXYZ[0];
            var valueY = valueXYZ[1];
            var valueZ = valueXYZ[2];
            data += `,unit=${unit} valueX=${valueX}i,valueY=${valueY}i,valueZ=${valueZ}i`; // values are integers.;
        }
        else if('systemStart' == evt.name) {
            value = repeat ? '0i' : '1i';
            data += ` value=${value}`;
        }
        // Catch any other event with a string value that hasn't been handled:
        else if (evt.value.match(/[^0-9\.,-]/)) { // match if any characters are not digits, period, comma, or hyphen.
            console.log(hubName, "handleEvent(): Found a string value that's not explicitly handled: Device Name: ${deviceName}, Event Name: ${evt.name}, Value: ${evt.value}","warn");
            var numMatch = evt.value.match(/[0-9.,-]+/);
            var txtMatch = evt.value.match(/[^0-9.,-]+/);
            if (numMatch && txtMatch) {
                const num = numMatch[0];
                const txt = txtMatch[0];
                value = '"' + num + '"';
                data += `,unit=${txt} value=${value}`;
            } else {
                data += ` value=${evt.value}`;
            }
        }
        // Catch any other general numerical event (carbonDioxide, power, energy, humidity, level, temperature, ultravioletIndex, voltage, etc).
        else {
            data += `,unit=${unit} value=${value}`;
        }

        // Add timestamp
        data += ` ${Date.now()}`;
        
        console.log(hubName, "data:", data);
        
        // Post data to InfluxDB:
        postToInfluxDB(data);

    }
}
