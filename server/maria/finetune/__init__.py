"""Fine-tuning da MAR IA — do diário de turnos ao modelo ajustado.

Fluxo:
1. `transcripts.registrar` grava cada turno real em data/turns.jsonl
   (pergunta, resposta, tools chamadas com args + resultado truncado).
2. `python -m finetune.revisar` — curadoria humana: aprova, edita ou
   rejeita turnos → data/curated.jsonl (o golden set de treino).
3. `python -m finetune.dataset` — converte curated + turnos aprovados
   no formato SFT da OpenAI (messages + tools) → ft_train/ft_valid.jsonl.
4. `python -m finetune.jobs pipeline` — upload + criação do job de
   fine-tuning na OpenAI; ao concluir, o nome ft:... vai para
   OPENAI_LLM_MODEL no .env.

Honestidade técnica: fine-tuning aqui serve para FIXAR estilo de fala,
persona e padrões de seleção de ferramentas — não ensina fatos do
sistema (isso é papel das tools e da base de conhecimento/RAG).
"""
