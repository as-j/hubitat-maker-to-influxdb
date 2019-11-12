const http = require('http');
const request = require('request');
const urlencode = require('urlencode');
const fs = require('fs');

const influxdb = require('./influxdb.js');

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

    var stats = {
        deviceEvents: {},
        measurementEvents: {},
        deviceMeasurementEvents: {},
    };

    const local_url = `${config.local_config.local_url}:${port}/`;
    console.log(hubName, "local_url", local_url);
    const local_url_encoded = urlencode(local_url);
    console.log(hubName, "Local url encoded", local_url_encoded);

    const post_to = `${hub.url}/postURL/${local_url_encoded}?access_token=${hub.token}`;
    console.log(hubName, "post_to", post_to);

    const session = influxdb.new_session(hubName, hub, config);

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

    function process_event(evt, repeat) {
        console.log(hubName, 'json:', evt);
        stats.deviceEvents[evt.displayName] = (stats.deviceEvents[evt.displayName] || 0) + 1;
        stats.measurementEvents[evt.name] = (stats.measurementEvents[evt.name] || 0) + 1;
        const combined = `${evt.displayName} ${evt.name}`;
        stats.deviceMeasurementEvents[combined] = (stats.deviceMeasurementEvents[combined] || 0) + 1;
        session.processEvt(evt, repeat);
    }

    setInterval( () => {
        console.log('stats', stats);
        for (const [type, sub_stat] of Object.entries(stats)) {
            for (const [displayName, count] of Object.entries(sub_stat)) {
                const evt = {
                    name: type,
                    value: count,
                    displayName: displayName,
                    deviceId: null,
                    descriptionText: `Count of events from ${displayName}`,
                    unit: 'count',
                    data: null,
                    skipStats: true,
                }
                // Call the session, don't add stats to stats
                session.processEvt(evt);
                stats[type][displayName] = 0;
            }
        }
        for (const [metaName, count] of Object.entries(session.stats)) {
            const evt = {
                name: 'appEvents',
                value: String(count),
                displayName: metaName,
                deviceId: null,
                descriptionText: `Count of app events from ${metaName}`,
                unit: 'count',
                data: null,
                skipStats: true,
            }
            // Call the session, don't add stats to stats
            session.processEvt(evt);
            session.stats[metaName] = 0;
        }
    }, 15*60*1000); // every 15 minutes send stats
}
