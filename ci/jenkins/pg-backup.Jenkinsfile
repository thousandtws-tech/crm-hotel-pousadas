// Backup diário do Postgres → MinIO (bucket `backups`, retenção 30 dias).
// Roda na rede privada do Railway — postgres.railway.internal não resolve fora dela.
pipeline {
    agent any
    options {
        disableConcurrentBuilds()
        timeout(time: 30, unit: 'MINUTES')
    }
    environment {
        PGCRED = credentials('pg-backup-pg')
        S3CRED = credentials('pg-backup-s3')
        PGHOST = 'postgres.railway.internal'
        PGDATABASE = 'railway'
    }
    stages {
        stage('dump → MinIO') {
            steps {
                sh '''
                    set -eu
                    export PGUSER="$PGCRED_USR" PGPASSWORD="$PGCRED_PSW"
                    FILE="pg-$(date +%F-%H%M).dump.gz"
                    pg_dump -Fc "$PGDATABASE" | gzip > "/tmp/$FILE"
                    mc alias set local http://bucket.railway.internal:9000 "$S3CRED_USR" "$S3CRED_PSW" >/dev/null
                    mc mb -p local/backups || true
                    mc cp "/tmp/$FILE" "local/backups/pg/$FILE"
                    rm -f "/tmp/$FILE"
                    mc rm --recursive --force --older-than 30d local/backups/pg/ || true
                '''
            }
        }
    }
    post {
        success { echo 'Backup enviado ao MinIO (backups/pg/, retencao 30d)' }
        failure { echo 'BACKUP FALHOU — verificar logs do stage' }
    }
}
