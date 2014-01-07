var util = require('util');
var path = require('path');
var yanop = require('yanop');
var fs = require('fs');
var colors = require('colors');
var mkdirp = require('mkdirp');

// Load bitcoinjs-server
var Bitcoin = require('../lib/bitcoin');
var logger = require('../lib/logger');
var Settings = require('../lib/settings').Settings;

var mods = [];

var getConfig = exports.getConfig = function getConfig(initConfig) {

  if ("object" !== typeof initConfig) {
    initConfig = {};
  }

  // Command-line arguments parsing
  var opts = yanop.simple({
    config: {
      type: yanop.string,
      short: 'c',
      description: 'Configuration file'
    },
    homedir: {
      type: yanop.string,
      description: 'Path to BitcoinJS home directory (default: ~/.bitcoinjs/)'
    },
    datadir: {
      type: yanop.string,
      description: 'Data directory, relative to home dir (default: .)'
    },
    addnode: {
      type: yanop.list,
      description: 'Add a node to connect to'
    },
    forcenode: {
      type: yanop.list,
      description: 'Always maintain a connection to this node'
    },
    connect: {
      type: yanop.string,
      description: 'Connect only to the specified node'
    },
    nolisten: {
      type: yanop.flag,
      description: 'Disable incoming connections'
    },
    livenet: {
      type: yanop.flag,
      description: 'Use the regular network (default)'
    },
    testnet: {
      type: yanop.flag,
      description: 'Use the test network'
    },
    port: {
      type: yanop.scalar,
      short: 'p',
      description: 'Port to listen for incoming connections'
    },
    rpcuser: {
      type: yanop.string,
      description: 'Username for JSON-RPC connections'
    },
    rpcpassword: {
      type: yanop.string,
      description: 'Password for JSON-RPC connections'
    },
    rpcport: {
      type: yanop.scalar,
      description: 'Listen for JSON-RPC connections on <port> (default: 8432)'
    },
    netdbg: {
      type: yanop.flag,
      description: 'Enable networking debug messages'
    },
    bchdbg: {
      type: yanop.flag,
      description: 'Enable block chain debug messages'
    },
    rpcdbg: {
      type: yanop.flag,
      description: 'Enable JSON RPC debug messages'
    },
    scrdbg: {
      type: yanop.flag,
      description: 'Enable script parser/interpreter debug messages'
    },
    mods: {
      type: yanop.string,
      short: 'm',
      description: 'Comma-separated list of mods to load'
    },
    noverify: {
      type: yanop.flag,
      description: 'Disable all tx/block verification'
    },
    noverifyscripts: {
      type: yanop.flag,
      description: 'Disable tx scripts verification'
    }
  });

  // Print welcome message
  if (initConfig.welcome) {
    require("./welcome");
  }

  //
  // Configuration file
  //
  logger.info('Loading configuration');

  // Calculate config file path
  var configPath, homeDir;
  if (opts.given.config) {
    // Explicit config file path provided via flag
    configPath = path.resolve(opts.given.config);
  } else {
    var defHome = Settings.getDefaultHome() + (opts.given.testnet ? '/testnet' : '');
    homeDir = opts.given.homedir ? path.resolve(opts.given.homedir) : defHome;
    configPath = path.resolve(homeDir, './settings');

    // DEPRECATED: Search in source tree for daemon/settings.js
    try {
      require.resolve('./settings');
      configPath = './settings';
    } catch (e) {}
  }
  try {
    // Check if config file exists (throws an exception otherwise)
    require.resolve(configPath);
  } catch (e) {
    if (configPath.substr(-3) !== '.js') configPath += '.js';

    var exampleConfigPath = path.resolve(__dirname, './settings.example.js');
    var targetConfigPath = path.resolve(__dirname, configPath);

    try {
      // Create config/home directory
      mkdirp.sync(path.dirname(configPath));

      // Copy example config file
      fs.writeFileSync(targetConfigPath, fs.readFileSync(exampleConfigPath));

      // Test config file
      require.resolve(configPath);

      logger.info('Automatically created config file');
      util.puts(
        "\n" +
          "| BitcoinJS created a new default config file at:\n" +
          "| " + targetConfigPath + "\n" +
          "| \n" +
          "| Please edit it to suit your requirements, for example to enable JSON-RPC.\n".bold);
    } catch (e) {
      logger.error('Unable to automatically create config file!');
      util.puts(
        "\n" +
          "| BitcoinJS was unable to locate or create a config file at:\n" +
          "| " + targetConfigPath + "\n" +
          "| \n" +
          "| Please create a config file in this location or provide the correct path\n" +
          "| to your config using the --config=/path/to/settings.js option.\n" +
          "| \n" +
          "| To get started you can copy the example config file from here:\n" +
          "| " + exampleConfigPath + "\n");
      process.exit(1);
    }
  }

  var cfg;
  try {
    cfg = global.cfg = new Settings();
    cfg.homedir = homeDir;
    var returnedCfg = require(configPath);

    if (returnedCfg instanceof Settings) {
      cfg = returnedCfg;
    }
  } catch (e) {
    logger.error('Error while loading configuration file:\n\n'+
                 (e.stack ? e.stack : e.toString()));
    process.exit(1);
  }

  if (!(cfg instanceof Bitcoin.Settings)) {
    logger.error('Configuration file did not provide a valid Settings object.\n');
    process.exit(1);
  }

  // Apply configuration from the command line
  if (opts.given.homedir) {
    cfg.homedir = opts.given.homedir;
  }
  if (opts.given.datadir) {
    cfg.datadir = opts.given.datadir;
  }
  if (opts.given.addnode) {
    cfg.network.initialPeers = cfg.network.initialPeers.concat(opts.given.addnode);
  }
  if (opts.given.forcenode) {
    cfg.network.initialPeers = cfg.network.forcePeers.concat(opts.given.forcenode);
  }
  if (opts.given.connect) {
    if (opts.given.connect.indexOf(',') != -1) {
      opts.given.connect = opts.given.connect.split(',');
    }
    cfg.network.connect = opts.given.connect;
  }
  if (opts.given.nolisten) {
    cfg.network.noListen = opts.given.nolisten;
  }
  if (opts.given.livenet) {
    cfg.setLivenetDefaults();
  } else if (opts.given.testnet) {
    cfg.setTestnetDefaults();
  }
  if (opts.given.port) {
    opts.given.port = +opts.given.port;
    if (opts.given.port > 65535 || opts.given.port < 0) {
      logger.error('Invalid port setting: "'+opts.given.port+'"');
    } else {
      cfg.network.port = opts.given.port;
    }
  }
  if (opts.given.rpcuser) {
    cfg.jsonrpc.enable = true;
    cfg.jsonrpc.username = opts.given.rpcuser;
  }
  if (opts.given.rpcpassword) {
    cfg.jsonrpc.enable = true;
    cfg.jsonrpc.password = opts.given.rpcpassword;
  }
  if (opts.given.rpcport) {
    opts.given.rpcport = +opts.given.rpcport;
    if (opts.given.port > 65535 || opts.given.port < 0) {
      logger.error('Invalid port setting: "'+opts.given.rpcport+'"');
    } else {
      cfg.jsonrpc.port = opts.given.rpcport;
    }
  }
  if (opts.given.netdbg) {
    logger.logger.levels.netdbg = 1;
  }
  if (opts.given.bchdbg) {
    logger.logger.levels.bchdbg = 1;
  }
  if (opts.given.rpcdbg) {
    logger.logger.levels.rpcdbg = 1;
  }
  if (opts.given.scrdbg) {
    logger.logger.levels.scrdbg = 1;
  }
  if (opts.given.mods) {
    cfg.mods = (("string" === typeof cfg.mods) ? cfg.mods+',' : '') +
      opts.given.mods;
  }
  if (opts.given.noverify) {
    cfg.verify = false;
  }
  if (opts.given.noverifyscripts) {
    cfg.verifyScripts = false;
  }

  return cfg;
};

var createNode = exports.createNode = function createNode(initConfig) {
  var cfg = getConfig(initConfig);

  // Return node object
  var node = new Bitcoin.Node(cfg);

  return node;
};
