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

module.exports = config

