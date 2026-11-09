// Deploy por changeset — cada push sobe apenas os serviços cujos paths
// mudaram. `railway up` envia o código e o build roda server-side;
// `-d` não bloqueia o pipeline esperando compilação.
pipeline {
    agent any
    options {
        disableConcurrentBuilds()
    }
    triggers {
        githubPush()
        // Fallback: se o webhook cair durante um restart do Jenkins,
        // o polling detecta o commit novo em ~10min.
        pollSCM('H/10 * * * *')
    }
    environment {
        RAILWAY_TOKEN   = credentials('railway-token')
        RAILWAY_PROJECT = '540c1145-2aa0-41a3-83d1-3ea71e659a52'
        RAILWAY_ENV     = 'production'
    }
    stages {
        stage('api') {
            when { anyOf {
                changeset 'server/crates/**'
                changeset 'server/migrations/**'
                changeset 'server/Cargo.*'
                changeset 'server/Dockerfile'
            } }
            steps { sh 'railway up -d -y -s api -e $RAILWAY_ENV -p $RAILWAY_PROJECT' }
        }
        stage('maria') {
            when { changeset 'server/maria/**' }
            steps { sh 'railway up -d -y -s maria -e $RAILWAY_ENV -p $RAILWAY_PROJECT' }
        }
        stage('realtime') {
            when { changeset 'server/realtime/**' }
            steps { sh 'railway up -d -y -s realtime -e $RAILWAY_ENV -p $RAILWAY_PROJECT' }
        }
        stage('admin') {
            when { changeset 'client/admin/**' }
            steps { sh 'railway up -d -y -s admin -e $RAILWAY_ENV -p $RAILWAY_PROJECT' }
        }
        stage('web') {
            when { changeset 'client/web/**' }
            steps { sh 'railway up -d -y -s web -e $RAILWAY_ENV -p $RAILWAY_PROJECT' }
        }
        stage('prometheus') {
            when { changeset 'monitoring/prometheus/**' }
            steps { sh 'railway up monitoring/prometheus --path-as-root -d -y -s prometheus -e $RAILWAY_ENV -p $RAILWAY_PROJECT' }
        }
        stage('grafana') {
            when { changeset 'monitoring/grafana/**' }
            steps { sh 'railway up monitoring/grafana --path-as-root -d -y -s grafana -e $RAILWAY_ENV -p $RAILWAY_PROJECT' }
        }
        stage('jenkins') {
            when { changeset 'ci/jenkins/**' }
            steps { sh 'railway up ci/jenkins --path-as-root -d -y -s jenkins -e $RAILWAY_ENV -p $RAILWAY_PROJECT' }
        }
        stage('iac-drift') {
            when { changeset '.railway/**' }
            steps {
                echo '.railway/railway.ts mudou — rode `railway config plan` e `railway config apply` manualmente (apply é destrutivo por design).'
            }
        }
    }
    post {
        failure { echo 'Falha no deploy — ver logs do estágio; o serviço anterior segue no ar (Railway mantém o último deploy saudável).' }
    }
}
