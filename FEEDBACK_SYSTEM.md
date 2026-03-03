# 🎨 Sistema de Feedback e Refinamento Iterativo

## Visão Geral

O sistema permite que você **melhore objetos gerados pela IA** através de feedback em linguagem natural. Depois de criar qualquer objeto aprendido (como castelo, torre, cadeira), você pode dar feedback sobre o que melhorar e o Ollama vai gerar uma versão aperfeiçoada.

---

## Como Funciona

### 1. **Criar Objeto**
Digite no chatbox: `cria um castelo`

O Ollama gera o objeto com, por exemplo, 6 partes.

### 2. **Painel de Feedback Aparece**
Automaticamente após a criação, aparece um painel no centro da tela:

```
Como posso melhorar este castelo?
[________________________]
[Melhorar] [Fechar]
```

O painel desaparece automaticamente após 10 segundos se não usar.

### 3. **Dar Feedback**
Digite sugestões em português:
- `falta uma ponte levadiça`
- `torres muito pequenas, aumenta elas`
- `adiciona ameias no topo das torres`
- `falta uma porta principal`
- `adiciona janelas nas torres`

Pressione **Enter** ou clique em **Melhorar**.

### 4. **Objeto Refinado**
O Ollama:
1. Analisa a composição atual
2. Lê seu feedback
3. Gera versão melhorada mantendo o que funciona e adicionando/ajustando conforme feedback
4. Substitui o objeto antigo pelo novo automaticamente

---

## Fluxo Técnico

### Frontend (client)

**HTML** (`index.html`):
```html
<div id="feedback-panel" style="display: none;">
  <p>Como posso melhorar este <strong id="feedback-object-name"></strong>?</p>
  <input type="text" id="feedback-input" />
  <button id="btn-submit-feedback">Melhorar</button>
  <button id="btn-cancel-feedback">Fechar</button>
</div>
```

**Engine** (`engine.js`):
```javascript
addComposite({ composition, x, z, name }) {
  // ... create object ...
  
  // Track last created composite for feedback
  this.lastComposite = { name, composition, object: group };
  this.showFeedbackPrompt(name);  // Show feedback panel
}

async submitFeedback(feedback) {
  const response = await fetch('http://localhost:3000/api/feedback', {
    method: 'POST',
    body: JSON.stringify({
      concept: this.lastComposite.name,
      feedback: feedback,
      currentComposition: this.lastComposite.composition
    })
  });
  
  const data = await response.json();
  
  // Remove old object
  this.scene.remove(this.lastComposite.object);
  
  // Add improved version
  this.addComposite({
    composition: data.improved.composition,
    x: pos.x,
    z: pos.z,
    name: this.lastComposite.name
  });
}
```

**Event Listeners** (`chatbox/script.js`):
```javascript
// Submit on Enter
feedbackInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    window.engine.submitFeedback(feedbackInput.value);
  }
});

// Close on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    feedbackPanel.style.display = 'none';
  }
});
```

---

### Backend (server)

**API Endpoint** (`api/feedback.js`):
```javascript
router.post('/', async (req, res) => {
  const { concept, feedback, currentComposition } = req.body;
  
  const improved = await refineWithFeedback(concept, currentComposition, feedback);
  
  res.json({ 
    ok: true, 
    improved: improved,
    parts: improved.composition.length
  });
});
```

**AI Learner** (`ai-learner.js`):
```javascript
export async function refineWithFeedback(conceptName, currentComposition, userFeedback) {
  // Build prompt with current composition and feedback
  const currentParts = currentComposition.map((part, i) => 
    `Part ${i+1}: ${part.type} ${JSON.stringify(part.params)}`
  ).join('\\n');
  
  const prompt = `You are a 3D geometry expert improving a "${conceptName}".

CURRENT COMPOSITION (${currentComposition.length} parts):
${currentParts}

USER FEEDBACK: "${userFeedback}"

TASK: Create IMPROVED version that:
1. Keeps what works well
2. Addresses user feedback
3. Results in better ${conceptName}

Respond with JSON...`;

  // Call Ollama
  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      model: 'llama3.2:3b',
      prompt: prompt,
      options: { temperature: 0.4, num_predict: 1000 }
    })
  });
  
  // Parse response
  const data = await response.json();
  const improved = JSON.parse(extractJSON(data.response));
  
  // Save to database
  db.learned_objects[conceptName] = {
    ...improved,
    refined: true,
    feedback: userFeedback
  };
  saveDB(db);
  
  // Update config
  config[conceptName] = {
    composition: improved.composition,
    builder: 'addComposite'
  };
  saveConfig(config);
  
  return improved;
}
```

---

## Exemplos de Uso

### Castelo
**1ª tentativa:**
```
cria um castelo
```
→ Gera castelo básico com 6 partes

**Feedback:**
```
falta uma ponte levadiça e torres nas pontas
```
→ Nova versão com 10 partes (ponte + 4 torres)

**Feedback:**
```
adiciona ameias no topo das torres
```
→ Versão final com 14 partes (ameias adicionadas)

---

### Cadeira
**1ª tentativa:**
```
cria uma cadeira
```
→ Gera assento + encosto (2 partes)

**Feedback:**
```
faltam 4 pernas
```
→ Nova versão com 6 partes completas

---

### Torre
**1ª tentativa:**
```
cria uma torre
```
→ Gera estrutura básica

**Feedback:**
```
faz ela em espiral criativa
```
→ Nova versão com geometria espiral

---

## Logs do Servidor

Quando você dá feedback, verá no console do servidor:

```
💬 Feedback recebido para "castelo": "falta uma ponte levadiça"
🔄 Refinando "castelo" com feedback: "falta uma ponte levadiça"
✓ Ollama melhorou definição: 6 → 10 partes
✅ "castelo" refinado e salvo com sucesso!
```

---

## Persistência

### `learning-db.json`
```json
{
  "learned_objects": {
    "castelo": {
      "composition": [...],
      "refined": true,
      "feedback": "falta uma ponte levadiça",
      "learned_at": "2026-02-27T15:30:00.000Z"
    }
  },
  "interaction_log": [
    {
      "timestamp": "2026-02-27T15:30:00.000Z",
      "action": "refined",
      "concept": "castelo",
      "feedback": "falta uma ponte levadiça",
      "parts_before": 6,
      "parts_after": 10,
      "success": true
    }
  ]
}
```

### `objects-config.json`
A definição refinada substitui a anterior automaticamente.

---

## Atalhos de Teclado

- **Enter** no campo de feedback → Submeter feedback
- **Escape** → Fechar painel de feedback
- **Clicar fora** → Painel fecha após 10 segundos automaticamente

---

## Limitações

1. **Ollama deve estar rodando** (`ollama serve`)
2. **Feedback em português** funciona melhor que inglês com o modelo atual
3. **Timeout de 40 segundos** - refinamentos muito complexos podem falhar
4. **Só funciona com objetos aprendidos** (composites) - primitivos (wall, cube) não têm feedback

---

## Troubleshooting

### Painel não aparece
- Verifique console do navegador (F12)
- Certifique-se de que criou um objeto **aprendido** (não primitivos)

### "Erro ao melhorar objeto"
- Verifique se Ollama está rodando: `curl http://localhost:11434/api/tags`
- Veja logs do servidor: erro de timeout ou JSON inválido?

### Feedback não melhora
- Seja específico: ❌ "melhora" → ✅ "adiciona 4 pernas"
- Descreva **o que falta** ou **o que ajustar**, não opinião genérica

---

## API Endpoints

### POST `/api/feedback`
**Request:**
```json
{
  "concept": "castelo",
  "feedback": "falta uma ponte levadiça",
  "currentComposition": [
    {"type": "cube", "params": {...}, "offset": {...}},
    ...
  ]
}
```

**Response:**
```json
{
  "ok": true,
  "message": "castelo melhorado com sucesso",
  "improved": {
    "composition": [...],
    "description": "Castelo com ponte levadiça adicionada",
    "keywords": ["castelo"]
  },
  "parts": 10
}
```

---

## Próximos Passos

1. **Multi-iteração**: Dar feedback múltiplas vezes no mesmo objeto
2. **Histórico de versões**: Ver todas as versões anteriores
3. **Desfazer refinamento**: Voltar à versão anterior
4. **Feedback visual**: Destacar partes adicionadas/modificadas
5. **Galeria de objetos**: Ver todos os objetos aprendidos e seus feedbacks

---

🎯 **Agora você pode criar objetos perfeitos através de refinamento iterativo!**
