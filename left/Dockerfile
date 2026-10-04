# Wrapper: Lucy + a /prompt adapter, so DockerAgentManager can run it unchanged.
#
# Lucy's ADK server speaks A2A JSON-RPC at POST / — not Dualing AI's POST /prompt.
# This image starts Lucy on an internal port and puts the adapter in front on
# $PORT (the variable DockerAgentManager injects).
ARG LUCY_TAG=v1.3.1
FROM lucyacr.azurecr.io/lucy:${LUCY_TAG}

# Adapter is stdlib-only — nothing to install.
COPY adapter.py /adapter/adapter.py
COPY start.sh   /adapter/start.sh
USER root
RUN chmod +x /adapter/start.sh

ENV PORT=8101 \
    LUCY_INTERNAL_PORT=8000 \
    SERVICE=adk-server \
    ADK_ENVIRONMENT=production \
    ADK_SSL_CERTFILE= \
    ADK_SSL_KEYFILE= \
    CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

EXPOSE 8101
ENTRYPOINT ["/adapter/start.sh"]
