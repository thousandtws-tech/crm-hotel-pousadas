FROM prom/prometheus:v3.5.0

USER root

COPY prometheus.yml.tpl /etc/prometheus/prometheus.yml.tpl
COPY alerts.yml /etc/prometheus/alerts.yml
COPY --chmod=755 entrypoint.sh /entrypoint.sh

RUN sed -i 's/\r$//' /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
