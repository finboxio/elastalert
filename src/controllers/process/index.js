import { spawn, spawnSync } from 'child_process';
import path from 'path'
import config from '../../common/config';
import Logger from '../../common/logger';
import { Status } from '../../common/status';

let logger = new Logger('ProcessController');

export default class ProcessController {

  constructor() {
    this._elastalertPath = config.get('elastalertPath');
    this._onExitCallbacks = [];
    this._status = Status.IDLE;

    /**
     * @type {ChildProcess}
     * @private
     */
    this._process = null;
  }

  onExit(onExitCallback) {
    this._onExitCallbacks.push(onExitCallback);
  }

  get status() {
    return this._status;
  }

  /**
   * Start ElastAlert if it isn't already running.
   */
  start() {
    // Do not do anything if ElastAlert is already running
    if (this._process !== null) {
      logger.warn('ElastAlert is already running!');
      return;
    }

    // Start ElastAlert from the directory specified in the config
    logger.info('Starting ElastAlert');
    this._status = Status.STARTING;

    // Create ElastAlert index if it doesn't exist yet
    logger.info('Creating index');
    var indexCreate = spawnSync('python3', ['-m', 'elastalert.create_index', '--config', path.join(this._elastalertPath, 'config.yaml')], {
      cwd: this._elastalertPath
    });

    // Redirect stdin/stderr to logger
    if (indexCreate.stdout && indexCreate.stdout.toString() !== '') {
      logger.info(indexCreate.stdout.toString());
    }
    if (indexCreate.stderr && indexCreate.stderr.toString() !== '') {
      logger.error(indexCreate.stderr.toString());
    }

    // Set listeners for index create exit
    if (indexCreate.status === 0) {
      logger.info(`Index create exited with code ${indexCreate.status}`);
    } else {
      logger.error(`Index create exited with code ${indexCreate.status}`);
      logger.warn('ElastAlert will start but might not be able to save its data!');
    }

    logger.info('Starting elastalert');

    this._process = spawn('python3', ['-m', 'elastalert.elastalert', '--config', path.join(this._elastalertPath, 'config.yaml')], {
      cwd: this._elastalertPath
    });

    logger.info(`Started Elastalert (PID: ${this._process.pid})`);
    this._status = Status.READY;

    // Redirect stdin/stderr to logger
    this._process.stdout.on('data', (data) => {
      logger.info(data.toString());
    });
    this._process.stderr.on('data', (data) => {
      logger.error(data.toString());
    });

    // Set listeners for ElastAlert exit
    this._process.on('exit', (code) => {
      if (code === 0) {
        logger.info(`ElastAlert exited with code ${code}`);
        this._status = Status.IDLE;
      } else {
        logger.error(`ElastAlert exited with code ${code}`);
        this._status = Status.ERROR;
      }
      this._process = null;

      this._onExitCallbacks.map(function(onExitCallback) {
        if (onExitCallback !== null) {
          onExitCallback();
        }
      });
    });

    // Set listener for ElastAlert error
    this._process.on('error', (err) => {
      logger.error(`ElastAlert error: ${err.toString()}`);
      this._status = Status.ERROR;
      this._process = null;
    });
  }

  /**
   * Stop ElastAlert if it is running.
   */
  stop() {
    if (this._process !== null) {
      // Stop ElastAlert
      logger.info(`Stopping ElastAlert (PID: ${this._process.pid})`);
      this._status = Status.CLOSING;
      this._process.kill('SIGINT');
    } else {
      // Do not do anything if ElastAlert is not running
      logger.info('ElastAlert is not running');
    }
  }
}
