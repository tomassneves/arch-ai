# 🧠 Sistema de Aprendizagem Dinâmica - AI Arch

## 📚 Como Funciona

O sistema implementa **aprendizagem adaptativa** que permite ao programa criar objetos 3D que nunca viu antes:

### Fluxo de Aprendizagem

```
1. Usuário: "uma árvore"
   ↓
2. Parser: Não reconhece "árvore" → Consulta IA externa
   ↓
3. IA: "árvore = cilindro (tronco) + esfera (copa)"
   ↓
4. Sistema: Salva definição em learning-db.json + objects-config.json
   ↓
5. Cria a árvore decompoN em primitivas
   ↓
6. Próxima vez: Já sabe fazer árvore automaticamente ✅
```

## 🔧 Arquitetura

### Componentes Principais

1. **`server/ai-learner.js`** - Motor de aprendizagem
   - `learnNewConcept(conceptName)` - Aprende novos objetos
   - `queryExternalAI(conceptName)` - Consulta LLM externo (STUB)
   - `logInteraction()` - Regista todas interações para fine-tuning

2. **`server/learning-db.json`** - Base de dados de aprendizagem
   ```json
   {
     "learned_objects": {
       "árvore": {
         "composition": [...],
         "keywords": ["árvore", "tree"],
         "learned_at": "2026-02-27T...",
         "usage_count": 0
       }
     },
     "interaction_log": [...]
   }
   ```

3. **`client/src/engine/objects-config.json`** - Config dinâmica
   - Atualizada automaticamente quando sistema aprende algo novo

4. **`server/llm.js`** - Parser inteligente
   - Tenta reconhecer com keywords
   - Se falhar → chama `learnNewConcept()`
   - Atualiza config e tenta novamente

## 🎯 Objetos Pré-Aprendidos (STUB)

O sistema vem com 3 conceitos hardcoded em `ai-learner.js`:

### 1. Árvore
```json
{
  "composition": [
    { "type": "cylinder", "params": { "diameter": 0.3, "height": 2 }, "offset": { "y": 0 } },
    { "type": "sphere", "params": { "radius": 1 }, "offset": { "y": 2.5 } }
  ],
  "keywords": ["árvore", "arvore", "tree", "trees"]
}
```

### 2. Cadeira
```json
{
  "composition": [
    { "type": "cube", "params": { "size": 0.5 }, "offset": { "y": 0.25 } },
    { "type": "cube", "params": { "width": 0.5, "height": 0.8, "depth": 0.05 }, 
      "offset": { "y": 0.9, "z": -0.225 } }
  ],
  "keywords": ["cadeira", "chair"]
}
```

### 3. Mesa
```json
{
  "composition": [
    { "type": "cube", "params": { "width": 2, "height": 0.1, "depth": 1 }, "offset": { "y": 0.75 } },
    // + 4 pernas (cilindros)
  ],
  "keywords": ["mesa", "table"]
}
```

## 🚀 Testar Agora

### No chat da aplicação:
```
"uma árvore"     → Cria árvore (aprende na 1ª vez)
"3 cadeiras"     → Cria 3 cadeiras
"uma mesa"       → Cria mesa com 4 pernas
"um cubo"        → Primitiva básica (já conhecida)
"algo_novo"      → Tenta aprender, senão cria parede por defeito
```

### Verificar estatísticas:
```bash
curl http://localhost:3000/api/stats
```

Resposta:
```json
{
  "total_learned": 3,
  "total_interactions": 5,
  "learned_concepts": ["árvore", "cadeira", "mesa"]
}
```

## 🔌 Integrar LLM Real (OpenAI/Claude/Llama)

### PASSO 1: Instalar SDK
```bash
npm install openai  # ou anthropic, ou @huggingface/inference
```

### PASSO 2: Adicionar API Key
```bash
# server/.env
OPENAI_API_KEY=sk-...
# ou
ANTHROPIC_API_KEY=sk-ant-...
```

### PASSO 3: Modificar `queryExternalAI()` em `ai-learner.js`

#### Opção A: OpenAI GPT-4
```javascript
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function queryExternalAI(conceptName) {
  const prompt = `Como representar geometricamente um(a) ${conceptName} usando primitivas 3D (cube, cylinder, sphere, cone)?

Responde em JSON com este formato:
{
  "composition": [
    {"type": "cylinder", "params": {"diameter": 0.5, "height": 2}, "offset": {"x": 0, "y": 0, "z": 0}},
    ...
  ],
  "description": "Descrição breve",
  "keywords": ["palavra1", "palavra2"]
}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4-turbo",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" }
  });

  return JSON.parse(response.choices[0].message.content);
}
```

#### Opção B: Anthropic Claude
```javascript
import Anthropic from '@anthropic-ai/sdk';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function queryExternalAI(conceptName) {
  const prompt = `...`; // mesmo prompt

  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: prompt
    }]
  });

  return JSON.parse(response.content[0].text);
}
```

#### Opção C: Llama Local (llama.cpp)
```javascript
async function queryExternalAI(conceptName) {
  const response = await fetch('http://localhost:8080/completion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: `...`, // mesmo prompt
      temperature: 0.7,
      max_tokens: 512
    })
  });

  const data = await response.json();
  return JSON.parse(data.content);
}
```

## 📊 Sistema de Feedback Loop

Para melhorar com o tempo:

### 1. Registar Feedback do Utilizador
```javascript
// No frontend, quando utilizador deleta imediatamente
fetch('/api/feedback', {
  method: 'POST',
  body: JSON.stringify({
    concept: 'árvore',
    rating: 'bad', // ou 'good'
    reason: 'demasiado pequena'
  })
});
```

### 2. Ajustar Definições
O sistema pode re-treinar periodicamente com:
- Interações bem-sucedidas (não deletadas em 10s)
- Feedback explícito dos utilizadores
- Análise de padrões de uso

### 3. Fine-Tuning (Avançado)
```javascript
// Exportar dados para treino
const trainingData = interactions.map(i => ({
  input: i.text,
  output: i.spec
}));

// Usar para fine-tuning de Llama/GPT
```

## 🎮 Comandos Úteis

```bash
# Ver logs do servidor
cd server && node server.js

# Ver estatísticas
curl http://localhost:3000/api/stats | jq

# Limpar base de dados de aprendizagem
echo '{"learned_objects":{},"interaction_log":[]}' > server/learning-db.json

# Resetar configuração
git checkout client/src/engine/objects-config.json
```

## 🔬 Testes

### Teste 1: Aprender Novo Conceito
```bash
curl -X POST http://localhost:3000/api/interpret \
  -H "Content-Type: application/json" \
  -d '{"text": "uma árvore"}'
```

Deve:
1. Consultar IA (ou usar stub)
2. Criar `learning-db.json` com entrada "árvore"
3. Atualizar `objects-config.json`
4. Retornar spec com `composition`

### Teste 2: Reutilizar Conhecimento
```bash
# Segunda vez, deve ser instantâneo
curl -X POST http://localhost:3000/api/interpret \
  -H "Content-Type: application/json" \
  -d '{"text": "3 árvores"}'
```

### Teste 3: Conceito Desconhecido
```bash
curl -X POST http://localhost:3000/api/interpret \
  -H "Content-Type: application/json" \
  -d '{"text": "um dragão"}'
```

Se LLM stub não tem "dragão" → fallback para parede.
Com LLM real → tenta decompor dragão em primitivas!

## 🎯 Próximos Passos

1. ✅ **Sistema de Aprendizagem** - IMPLEMENTADO
2. ⏳ **Integrar LLM Real** - Substituir stub em `queryExternalAI()`
3. ⏳ **Sistema de Feedback** - Endpoint `/api/feedback`
4. ⏳ **Fine-Tuning Pipeline** - Exportar dados de treino
5. ⏳ **UI de Gestão** - Painel para ver/editar objetos aprendidos
6. ⏳ **Partilha de Conhecimento** - Sincronizar learning-db entre utilizadores

## 💡 Conceitos Chave

- **Few-Shot Learning**: LLM aprende com exemplos (interaction_log)
- **Decomposição em Primitivas**: Qualquer objeto → combinação de cube/cylinder/sphere/cone
- **Aprendizagem Incremental**: Cada interação melhora o sistema
- **Fallback Gracioso**: Se não sabe, tenta aprender; se falhar, usa parede

---

**Resumo**: Agora podes dizer **qualquer coisa** ao programa e ele tenta aprender a fazer. Com LLM real, pode decompor objetos complexos (carros, casas, móveis) em geometria 3D automaticamente! 🚀
