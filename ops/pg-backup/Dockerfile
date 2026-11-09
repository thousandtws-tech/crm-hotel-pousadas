FROM postgres:18

# awscli para upload no MinIO (pacote Debian — sem download externo)
RUN apt-get update \
 && apt-get install -y --no-install-recommends awscli \
 && rm -rf /var/lib/apt/lists/*

COPY backup.sh /backup.sh
RUN chmod +x /backup.sh

# Serviço só-outbound: não expõe porta, ninguém conecta nele.
CMD ["/backup.sh"]
