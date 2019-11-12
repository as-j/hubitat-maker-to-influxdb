const http = require('http');

function escapeString(string) {
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

function hubDefaultBool(name, value, truth) {
    var unit = name;
    value = '"' + value + '"';
    var valueBinary = (truth == value) ? '0i' : '1i';
    return `,unit=${unit} value=${value},valueBinary=${valueBinary}`;
}

function isBoolType(evt_name) {
    return (boolTypes[evt_name]) ? true : false
}

const boolTypes = {
    acceleration: { truth: 'active', },
    alarm: { thruth: 'off', },
    button: { truth: 'pushed', },
    carbonMonoxide: { truth: 'detected', },
    consumableStatus: { truth: 'good', },
    contact: { truth: 'closted', },
    door: { truth: 'closed', },
    hsmSetArm: { truth: 'armAway', },
    hsmStatus: { truth: 'armedAway', },
    hsmAlert: { truth: 'intrusion', },
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

function new_session(hubName, hub, config) {
    var postTimer;
    var postQueue = [];
    var poll_timers = {};
    var stats = {
        totalEvents: 0,
        influxDBPosts: 0,
        influxDBErrors: 0,
    };

    function processEvt(evt, repeat) {
        if (!evt.skipStats) stats.totalEvents++;

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
        var deviceId = escapeString(deviceId.toString());
        var unit = escapeString(evt.unit);
        // Encure value is a string
        evt.value = String(evt.value);
        var value = escapeString(evt.value);
        const deviceName = escapeString(evt.displayName);
        const hubNameEsc = escapeString(hubName);
        const hubId = escapeString(hub.hubId);
        const locationId = escapeString(hub.locationId);
        const locationName = escapeString(hub.locationName);
        const is_repeat = escapeString((repeat) ? 'true' : 'false');
        var valueBinary = '';

        var data = `${measurement},deviceId=${deviceId},deviceName=${deviceName},hubName=${hubNameEsc},hubId=${hubId},locationId=${locationId},locationName=${locationName},repeat=${is_repeat}`;

        if (isBoolType(evt.name)) {
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
                stats.influxDBPosts++;

                if (res.statusCode != 204) {
                    console.log(hubName, `STATUS: ${res.statusCode}`);
                    console.log(hubName, `HEADERS: ${JSON.stringify(res.headers)}`);
                    stats.influxDBErrors++;
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
    return {
        processEvt: processEvt,
        postToInfluxDB: postToInfluxDB,
        stats: stats,
    }
}

module.exports = {
    new_session: new_session,
}


