FROM postgres:17-bookworm AS pgtools

FROM jenkins/jenkins:lts-jdk21

USER root

# Railway CLI (npm wrapper) — o deploy acontece server-side no Railway,
# então o agente só precisa do binário + git (já incluso na imagem base).
RUN apt-get update \
 && apt-get install -y --no-install-recommends nodejs npm \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @railway/cli

# Backup job: pg_dump copiado da imagem oficial postgres:17 (mesma versão do server)
# + mc (MinIO client) para upload no bucket.
COPY --from=pgtools /usr/lib/postgresql/17/bin/pg_dump /usr/local/bin/pg_dump
COPY --from=pgtools /usr/lib/x86_64-linux-gnu/libpq.so.5* /usr/lib/x86_64-linux-gnu/
RUN apt-get update \
 && apt-get install -y --no-install-recommends liblz4-1 libzstd1 libgssapi-krb5-2 libldap-2.5-0 \
 && rm -rf /var/lib/apt/lists/* \
 && ldconfig \
 && curl -fsSL -o /usr/local/bin/mc https://dl.min.io/client/mc/release/linux-amd64/mc \
 && chmod +x /usr/local/bin/mc

COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt

COPY casc/ /usr/share/jenkins/ref/casc/

ENV CASC_JENKINS_CONFIG=/usr/share/jenkins/ref/casc/jenkins.yaml \
    JAVA_OPTS="-Djenkins.install.runSetupWizard=false"
