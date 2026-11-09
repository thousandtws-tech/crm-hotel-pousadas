FROM jenkins/jenkins:lts-jdk21

USER root

# Railway CLI (npm wrapper) — o deploy acontece server-side no Railway,
# então o agente só precisa do binário + git (já incluso na imagem base).
RUN apt-get update \
 && apt-get install -y --no-install-recommends nodejs npm \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @railway/cli

# Backup do Postgres roda num serviço dedicado (ops/pg-backup), não aqui.

COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt

COPY casc/ /usr/share/jenkins/ref/casc/

ENV CASC_JENKINS_CONFIG=/usr/share/jenkins/ref/casc/jenkins.yaml \
    JAVA_OPTS="-Djenkins.install.runSetupWizard=false"
