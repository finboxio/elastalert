FROM alpine:latest as py-ea
ARG ELASTALERT_VERSION=v0.2.1
ENV ELASTALERT_VERSION=${ELASTALERT_VERSION}
# URL from which to download Elastalert.
ARG ELASTALERT_URL=https://github.com/Yelp/elastalert/archive/$ELASTALERT_VERSION.zip
ENV ELASTALERT_URL=${ELASTALERT_URL}
# Elastalert home directory full path.
ENV ELASTALERT_HOME /opt/elastalert

WORKDIR /opt

RUN apk add --update --no-cache ca-certificates openssl-dev openssl python3-dev python3 py3-pip py3-yaml libffi-dev gcc musl-dev wget rust cargo && \
# Download and unpack Elastalert.
    wget -O elastalert.zip "${ELASTALERT_URL}" && \
    unzip elastalert.zip && \
    rm elastalert.zip && \
    mv e* "${ELASTALERT_HOME}"

WORKDIR "${ELASTALERT_HOME}"

# Install Elastalert.
# see: https://github.com/Yelp/elastalert/issues/1654
RUN sed -i 's/jira>=1.0.10,<1.0.15/jira>=2.0.0/g' setup.py && \
    sed -i 's/jira>=1.0.10,<1.0.15/jira>=2.0.0/g' requirements.txt && \
    sed -i 's/elasticsearch>=7.0.0/elasticsearch==7.1.0/g' setup.py && \
    sed -i 's/elasticsearch>=7.0.0/elasticsearch==7.1.0/g' requirements.txt && \
    sed -i 's/data=json.dumps(payload, cls=DateTimeEncoder, ensure_ascii=False)/data=json.dumps(payload, cls=DateTimeEncoder, ensure_ascii=False).encode("utf-8")/' elastalert/alerts.py && \
    pip3 install --upgrade setuptools-rust && \
    python3 setup.py install && \
    pip3 install -r requirements.txt

FROM node:alpine
LABEL maintainer="BitSensor <dev@bitsensor.io>"
# Set timezone for this container
ENV TZ Etc/UTC

RUN apk add --update --no-cache curl tzdata python3 make libmagic

COPY --from=py-ea /usr/lib/python3.8/site-packages /usr/lib/python3.8/site-packages
COPY --from=py-ea /opt/elastalert /opt/elastalert
COPY --from=py-ea /usr/bin/elastalert* /usr/bin/

WORKDIR /opt/elastalert-server

COPY package.json /opt/elastalert-server/package.json
RUN npm install --production --quiet

COPY . /opt/elastalert-server
COPY config/elastalert.yaml /opt/elastalert/config.yaml
COPY config/elastalert-test.yaml /opt/elastalert/config-test.yaml
COPY config/config.json config/config.json
COPY rule_templates/ /opt/elastalert/rule_templates
COPY elastalert_modules/ /opt/elastalert/elastalert_modules

# Add default rules directory
# Set permission as unpriviledged user (1000:1000), compatible with Kubernetes
RUN mkdir -p /opt/elastalert/rules/ /opt/elastalert/server_data/tests/ && \
    chown -R node:node /opt/elastalert && \
    chown -R node:node /opt/elastalert-server

USER node

EXPOSE 3030
ENTRYPOINT ["npm", "start"]
