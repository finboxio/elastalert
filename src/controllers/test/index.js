import Logger from '../../common/logger';
import FileSystem from '../../common/file_system';
import config from '../../common/config';
import path from 'path';
import randomstring from 'randomstring';
import {spawn} from 'child_process';

let logger = new Logger('TestController');
let fileSystem = new FileSystem();

export default class TestController {
  constructor(server) {
    this._server = server;
    this._elastalertPath = config.get('elastalertPath');
    this.testFolder = this._getTestFolder();

    fileSystem.createDirectoryIfNotExists(this.testFolder).catch(function (error) {
      logger.error(`Failed to create the test folder in ${this.testFolder} with error:`, error);
    });
  }

  testRule(rule, options, socket) {
    const self = this;
    let tempFileName = '~' + randomstring.generate() + '.temp';
    let tempFilePath = path.join(self.testFolder, tempFileName);

    return new Promise(function (resolve, reject) {
      fileSystem.writeFile(tempFilePath, rule)
        .then(function () {
          let processOptions = [];
          let stdoutLines = [];
          let stderrLines = [];

          processOptions.push('-m', 'elastalert.test_rule', '--config', path.join(self._elastalertPath, 'config.yaml'));

          if (options.days) {
            processOptions.push('--days', options.days)
          }

          if (options.format === 'json') {
            processOptions.push('--formatted-output');
          }

          if (options.maxResults > 0) {
            processOptions.push('--max-query-size', options.maxResults);
          }

          if (options.alert) {
            processOptions.push('--alert');
          }

          switch (options.testType) {
            case 'schemaOnly':
              processOptions.push('--schema-only');
              break;
            case 'countOnly':
              processOptions.push('--count-only');
              break;
          }

          const env = {
            ES_HOST: config.get('es_host'),
            ES_PORT: config.get('es_port'),
            ES_USE_SSL: config.get('use_ssl'),
            ES_USERNAME: config.get('es_username'),
            ES_PASSWORD: config.get('es_password')
          }

          for (const key in process.env) { env[key] = process.env[key] }

          try {
            processOptions.push(tempFilePath)
            let testProcess = spawn('python3', processOptions, {
              cwd: self._elastalertPath,
              env
            });

            // When the websocket closes we kill the test process
            // so it doesn't keep running detached
            if (socket) {
              socket.on('close', () => {
                testProcess.kill();

                fileSystem.deleteFile(tempFilePath)
                  .catch(function (error) {
                    logger.error(`Failed to delete temporary test file ${tempFilePath} with error:`, error);
                  });
              });
            }

            testProcess.stdout.on('data', function (data) {
              if (socket) {
                socket.send(JSON.stringify({
                  event: 'result',
                  data: data.toString()
                }));
              }
              stdoutLines.push(data.toString());
              logger.info(data.toString())
            });

            testProcess.stderr.on('data', function (data) {
              if (socket) {
                socket.send(JSON.stringify({
                  event: 'progress',
                  data: data.toString()
                }));
              }
              stderrLines.push(data.toString());
              logger.error(data.toString())
            });

            testProcess.on('exit', function (statusCode) {
              if (statusCode === 0) {
                if (options.format === 'json') {
                  resolve(stdoutLines.join(''));
                }
                else {
                  resolve(stdoutLines.join('\n'));
                }
              } else {
                if (!socket) {
                  reject(stderrLines.join('\n'));
                  logger.error(stderrLines.join('\n'));
                }
              }

              fileSystem.deleteFile(tempFilePath)
                .catch(function (error) {
                  logger.error(`Failed to delete temporary test file ${tempFilePath} with error:`, error);
                });
            });
          } catch (error) {
            logger.error(`Failed to start test on ${tempFilePath} with error:`, error);
            reject(error);
          }
        })
        .catch(function (error) {
          logger.error(`Failed to write file ${tempFileName} to ${self.testFolder} with error:`, error);
          reject(error);
        });
    }).catch((error) => {
      logger.error('Failed to test rule with error:', error);
    });
  }

  _getTestFolder() {
    return path.join(this._server.getDataFolder(), 'tests');
  }
}
