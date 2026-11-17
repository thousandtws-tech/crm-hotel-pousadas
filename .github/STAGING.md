# Ambiente `staging` — Railway

O Railway não permite criar ambientes via código/CI; o setup é manual no dashboard:

1. No projeto, **New Environment** → nome `staging`.
2. Em cada serviço, duplique as variáveis a partir de `production` (**Variables → Duplicate from environment**), ajustando URLs/segredos que forem específicos de staging.
3. Em **Settings → Source**, conecte a branch `staging` ao ambiente.
4. Opcional: habilite auto-deploy para pushes em `staging` no trigger do serviço.

A partir daí, merges na branch `staging` publicam no ambiente de homologação.
