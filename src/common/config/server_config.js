import Joi from 'joi';
import fs from 'fs';
import URL from 'url';
import path from 'path';
import schema from './schema';
import resolvePath from 'object-resolve-path';
import Logger from '../logger';
import YAML from 'yaml'

// Config file relative from project root
const configFile = 'config/config.json';
const devConfigFile = 'config/config.dev.json';

const configPath = path.join(process.cwd(), configFile);
const devConfigPath = path.join(process.cwd(), devConfigFile);
const logger = new Logger('Config');

export default class ServerConfig {
  constructor() {
    // ready() callbacks
    this._waitList = [];

    // Actual config
    this._jsonConfig = null;
  }

  /**
   * Get a value from the config.
   *
   * @param {String} key The key to load the value from.
   * @returns {*}
   */
  get(key) {
    return resolvePath(this._jsonConfig, key);
  }

  /**
   * Register a callback to call when the config is ready loading.
   *
   * @param {Function} callback The callback to register.
   */
  ready(callback) {
    this._waitList.push(callback);
  }

  /**
   * Loads the config by reading the config file or falling back to defaults.
   *
   * @returns {Promise} Returns a promise which resolves when everything is done (as a promise would).
   */
  load() {

    //TODO: Watch config file for changes and reload
    const self = this;
    return new Promise(function (resolve) {
      self._getConfig().then(function (config) {
        self._validate(config);
        resolve();
      });
    }).then(function () {
      self._waitList.forEach(function (callback) {
        callback();
      });
    });
  }

  _getConfig() {
    const self = this;

    return new Promise(function (resolve) {
      self._fileExists(devConfigPath).then(function (devConfigFound) {

        // If a dev config was found read it, otherwise check for normal config
        if (devConfigFound) {
          self._readFile(devConfigPath)
            .then(function (config) {
              resolve(JSON.parse(config));
            })
            .catch(function () {
              resolve({});
            });
        } else {
          logger.info('Proceeding to look for normal config file.');
          self._fileExists(configPath).then(function (configFound) {
            if (configFound) {
              self._readFile(configPath)
                .then(function (config) {
                  resolve(JSON.parse(config));
                })
                .catch(function () {
                  resolve({});
                });
            } else {
              logger.info('Using default config.');
              // If no config was found, return empty object to load defaults
              resolve({});
            }
          });
        }
      });
    }).then((json) => {
      const configDir = json['elastalertPath']
      if (configDir) {
        const file = path.join(configDir, 'config.yaml')
        const content = fs.readFileSync(file, 'utf8')
        const yaml = YAML.parse(content)

        if (process.env.ELASTICSEARCH_URL) {
          const url = URL.parse(process.env.ELASTICSEARCH_URL)
          logger.info(process.env.ELASTICSEARCH_URL, url)
          yaml['es_host'] = url.hostname
          yaml['es_port'] = parseInt(url.port) || 9200
          yaml['es_username'] = url.auth && url.auth.split(':')[0]
          yaml['es_password'] = url.auth && url.auth.split(':').slice(1).join(':')
          yaml['use_ssl'] = url.protocol === 'https:'
        }

        yaml['writeback_index'] = process.env.ELASTALERT_INDEX || yaml['writeback_index']
        yaml['run_every']['minutes'] = process.env.ELASTALERT_INTERVAL_MINUTES || yaml['run_every']['minutes']
        yaml['rules_folder'] = process.env.RULES_PATH || yaml['rules_folder']


        json['port'] = process.env.PORT || json['port']
        json['wsport'] = process.env.WSPORT || json['wsport']
        json['es_host'] = yaml['es_host']
        json['es_port'] = yaml['es_port']
        json['es_username'] = yaml['es_username']
        json['es_password'] = yaml['es_password']
        json['use_ssl'] = yaml['use_ssl']
        json['writeback_index'] = yaml['writeback_index']
        json['elastalertPath'] = process.env.ELASTALERT_PATH || json['elastalertPath']
        json['templatesPath'] = process.env.TEMPLATES_PATH ? { relative: false, path: process.env.TEMPLATES_PATH } : json['templatesPath']
        json['dataPath'] = process.env.DATA_PATH ? { relative: false, path: process.env.DATA_PATH } : json['dataPath']
        json['rulesPath'] = { relative: false, path: path.resolve(configDir, yaml['rules_folder']) }

        try {
          fs.mkdirSync(json['dataPath'].path, { recursive: true })
          fs.mkdirSync(json['rulesPath'].path, { recursive: true })
          fs.mkdirSync(json['templatesPath'].path, { recursive: true })
        } catch (e) {}

        fs.writeFileSync(file, YAML.stringify(yaml))
      }

      return json
    });
  }

  /**
   * Checks if the config file exists and we have reading permissions
   *
   * @returns {Promise} Promise returning true if the file was found and false otherwise.
   * @private
   */
  _fileExists(filePath) {
    return new Promise(function (resolve) {
      // Check if the config file exists and has reading permissions
      try {
        fs.access(filePath, fs.F_OK | fs.R_OK, function (error) {
          if (error) {
            if (error.errno === -2) {
              logger.info(`No ${path.basename(filePath)} file was found in ${filePath}.`);
            } else {
              logger.warn(`${filePath} can't be read because of reading permission problems. Falling back to default configuration.`);
            }
            resolve(false);
          } else {
            logger.info(`A config file was found in ${filePath}. Using that config.`);
            resolve(true);
          }
        });
      } catch (error) {
        logger.error('Error getting access information with fs using `fs.access`. Error:', error);
      }
    });
  }

  /**
   * Reads the config file.
   *
   * @returns {Promise} Promise returning the config if successfully read. Rejects if reading the config failed.
   * @private
   */
  _readFile(file) {
    return new Promise(function (resolve, reject) {
      fs.readFile(file, 'utf8', function (error, config) {
        if (error) {
          logger.warn(`Unable to read config file in (${file}). Using default configuration. Error: `, error);
          reject();
        } else {
          resolve(config);
        }
      });
    });
  }

  /**
   * Validate the config using the Joi schema.
   *
   * @param {Object} jsonConfig The config to validate.
   * @private
   */
  _validate(jsonConfig) {
    // Validate the JSON config
    try {
      this._jsonConfig = Joi.validate(jsonConfig, schema).value;
    } catch (error) {
      logger.error('The config in \'config/config.json\' is not a valid config configuration. Error: ', error);
    }
  }
}
