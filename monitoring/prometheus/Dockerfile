FROM prom/prometheus:v3.5.0

COPY prometheus.yml.tpl /etc/prometheus/prometheus.yml.tpl
COPY alerts.yml /etc/prometheus/alerts.yml
COPY --chmod=755 entrypoint.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
