const http = require('http');
const request = require('request');
const urlencode = require('urlencode');

const influxdb = require('./influxdb.js');
const config = require('./config.js');

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
            try {
                const jsonParsed = JSON.parse(body);
                process_event_stats(jsonParsed.content);
            } catch (e) {
                console.log(hubName, 'Failed to parse json from hubitat: ', body);
            }
            res.end('Done!\n');
        });
    });

    server.keepAliveTimeout = 5*60*1000;

    server.listen(port, config.local_config.hostname, () => {
          console.log(hubName, `Server running at http://${config.local_config.hostname}:${port}/`);
          console.log(hubName, 'Calling Maker API with:', post_to);
          request(post_to, (error, responce, body) => {
              if (error) console.error('error:', error);
              console.log(hubName, 'statusCode:', responce && responce.statusCode);
              console.log(hubName, 'body:', body);
          });
    });

    function process_event_stats(evt, repeat) {
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
