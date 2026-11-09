FROM postgres:17-bookworm

# mc (MinIO client) para upload no bucket privado do Railway
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /usr/local/bin/mc https://dl.min.io/client/mc/release/linux-amd64/mc \
 && chmod +x /usr/local/bin/mc

COPY backup.sh /backup.sh
RUN chmod +x /backup.sh

# Serviço só-outbound: não expõe porta, ninguém conecta nele.
CMD ["/backup.sh"]
