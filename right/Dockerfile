# Wrapper: Lucy + a /prompt adapter, so DockerAgentManager can run it unchanged.
#
# Lucy's ADK server speaks A2A JSON-RPC at POST / — not Dualing AI's POST /prompt.
# This image starts Lucy on an internal port and puts the adapter in front on
# $PORT (the variable DockerAgentManager injects).
# Lucy PR #550 (Pydantic AI migration) + #556 (blocker fixes) + #559 (resource
# search fix), merged on the local-only branch local/pr550-integration and
# built locally — not a released tag, so not in ACR. The image's
# lucy.git.sha label records the exact commit. The previous base,
# lucy:pr550-fixes (#550 + #556 only), is still available locally. Originals
# for the v1.2.0 setup are in ../.backup-v1.3.1-vs-v1.2.0/.
ARG LUCY_IMAGE=lucy:pr550-integration
FROM ${LUCY_IMAGE}

# Adapter is stdlib-only — nothing to install.
COPY adapter.py /adapter/adapter.py
COPY start.sh   /adapter/start.sh
USER root
RUN chmod +x /adapter/start.sh

ENV PORT=8102 \
    LUCY_INTERNAL_PORT=8000 \
    SERVICE=adk-server \
    ADK_ENVIRONMENT=production \
    ADK_SSL_CERTFILE= \
    ADK_SSL_KEYFILE= \
    CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

EXPOSE 8102
ENTRYPOINT ["/adapter/start.sh"]
