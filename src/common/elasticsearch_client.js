import elasticsearch from 'elasticsearch';
import config from './config';

export function getClient() {
  let host
  if (config.get('es_username') || config.get('es_password')) {
    host = `http${config.get('use_ssl') ? 's' : ''}://${config.get('es_username')}:${config.get('es_password')}@${config.get('es_host')}:${config.get('es_port')}`
  } else {
    host = `http${config.get('use_ssl') ? 's' : ''}://${config.get('es_host')}:${config.get('es_port')}`
  }
  var client = new elasticsearch.Client({
    hosts: [ host ]
  });
  return client;
}
