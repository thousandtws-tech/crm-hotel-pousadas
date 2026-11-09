FROM jenkins/jenkins:lts-jdk21

USER root

# Railway CLI (npm wrapper) — o deploy acontece server-side no Railway,
# então o agente só precisa do binário + git (já incluso na imagem base).
RUN apt-get update \
 && apt-get install -y --no-install-recommends nodejs npm \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @railway/cli

# Backup job: pg_dump (cliente PG17 — precisa >= versão do server) + mc (MinIO client)
RUN curl -fsSL -o /usr/share/keyrings/pgdg.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/keyrings/pgdg.asc] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-17 \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /usr/local/bin/mc https://dl.min.io/client/mc/release/linux-amd64/mc \
 && chmod +x /usr/local/bin/mc

COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt

COPY casc/ /usr/share/jenkins/ref/casc/

ENV CASC_JENKINS_CONFIG=/usr/share/jenkins/ref/casc/jenkins.yaml \
    JAVA_OPTS="-Djenkins.install.runSetupWizard=false"
