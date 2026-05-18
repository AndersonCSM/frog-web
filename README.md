# Documentação Técnica: Frog Run & AWS Serverless Integration

Este documento detalha as etapas de engenharia, infraestrutura e deployment do jogo **Frog Run**. O projeto consiste em uma aplicação SPA (Single Page Application) em Vanilla JavaScript consumindo uma arquitetura Serverless na AWS para persistência de *scores*, exigindo o uso de domínios customizados.

---

## 1. Arquitetura Geral

A solução implementa uma arquitetura baseada em microsserviços serverless na AWS:
- **Frontend App**: Cliente HTML/CSS/JS (Canvas API) sem dependência de frameworks ou build steps.
- **Continuous Deployment**: AWS Amplify gerenciando o repositório git e provisionando SSL.
- **REST API**: Amazon API Gateway configurado como endpoint Regional, roteando requisições `POST /score`.
- **Compute Layer**: AWS Lambda (Node.js 20.x) servindo como proxy de integração.
- **Data Layer**: Amazon DynamoDB atuando no modelo de consistência eventual para armazenamento do JSON *payload*.
- **DNS e Certificados**: Amazon Route 53 (Hosted Zone) gerenciando os records CNAME, com terminação TLS/SSL via AWS Certificate Manager (ACM).

---

## 2. Desenvolvimento do Frontend (Engine Vanilla JS)

O jogo "Frog Run" foi estruturado a partir do zero utilizando a API Canvas HTML5 e um game loop baseado em `requestAnimationFrame()`.

### Estrutura de Arquivos
```text
/
├── index.html
├── src/
│   ├── assets/
│   │   └── TalkingCuteChiptune.mp3
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── engine.js
```

### Características Técnicas (Engine.js)
- **Mecânica Central**: Travessia de matriz procedural. Obstáculos móveis (carros/troncos) com vetores de direção.
- **Sistema de Colisões (AABB + Pixel-Perfect drift)**: A colisão adota Bounding Boxes (AABB) simples em estradas. Na água, a colisão amarra o eixo X da entidade ao obstáculo e aplica um fator compensatório de *drift* no eixo Y para manter sincronismo visual com o Grid, impedindo "teleportes".
- **Controles**: Mapeamento de `keydown` para direções e `ESC` para interrupção de estado (Pausa). Implementação adicional de listeners `touchstart` para suporte Mobile responsivo.
- **Estados do Jogo**: Controle estruturado de `paused`, `over`, `started`, resetando instâncias entre `phaseComplete` e `gameOver`.

---

## 3. Infraestrutura AWS e Backend

O fluxo de dados exige o processamento de uma requisição `POST` originada pelo frontend no momento de Game Over.

### 3.1 Função AWS Lambda
- **Runtime**: Node.js 20
- **Responsabilidade**: Receber o payload do jogo e formatar a resposta. 
- *Exemplo de Função Proxy:*
```javascript
exports.handler = async (event) => {
  return {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "*"
    },
    body: JSON.stringify({ message: "POST funcionando!" })
  };
};
```
*(Nota: a integração com PutItem no DynamoDB ocorre neste contexto).*

### 3.2 Amazon API Gateway
1. **Instanciação**: Criação de uma *REST API* tipo *Regional*.
2. **Resource e Método**: Definição do path `/score` com método `POST`.
3. **Integration**: Configuração de *Lambda Proxy Integration* associada à Lambda supra citada.
4. **CORS Configuration**: Liberação explícita de CORS no resource `/score`, injetando métodos `OPTIONS` e `POST` com origem `*` no preflight request.
5. **Deployment**: Liberação da API em um novo Stage designado como `prod`.
- **URL Base Padrão gerada:** `https://xxxxx.execute-api.us-east-1.amazonaws.com/prod/score`

---

## 4. Configuração de DNS Personalizado (Route 53 & ACM)

A especificação exige roteamento do frontend e da API sob os domínios:
- Frontend: `[jogo].[nome].grupo5.sd.ufersa.dev.br`
- API REST: `api.[nome].grupo5.sd.ufersa.dev.br`

### 4.1 Deployment do Frontend no AWS Amplify
1. Repositório conectado ao Amplify via console AWS.
2. Em **Domain management**, adição de domínio e mapeamento de subdomínio: `frogrun.anderson.grupo5.sd.ufersa.dev.br`.
3. O Amplify gera e gerencia automaticamente os registros e os certificados SSL pertinentes à interface web.

### 4.2 Domínio Personalizado da API REST
Diferente do Amplify, o mapeamento de domínio no API Gateway exige três etapas manuais:

#### A. Emissão do Certificado (AWS Certificate Manager - ACM)
1. Requisição de *Public Certificate* na região `us-east-1`.
2. Domínio: `api.anderson.grupo5.sd.ufersa.dev.br`.
3. Método de validação: **DNS Validation**.
4. O ACM emite um par `CNAME name` e `CNAME value`.
5. Inserção deste par na Hosted Zone `anderson.grupo5.sd.ufersa.dev.br` no **Route 53** até o status do certificado constar como *Issued*.

#### B. API Gateway Custom Domains
1. Navegação para **Custom domain names** no console do API Gateway.
2. Criação do domínio `api.anderson.grupo5.sd.ufersa.dev.br`, tipo *Regional*.
3. Seleção do certificado recém-emitido no ACM.
4. Definição do **API Mapping**:
   - **API**: (Nome da API REST)
   - **Stage**: `prod`
   - **Path**: Vazio.
5. O console disponibiliza o **API Gateway Domain Name** (ex: `d-xxxxx.execute-api.us-east-1.amazonaws.com`).

#### C. Apontamento Final no Amazon Route 53
1. Criação de novo record na Hosted Zone `anderson.grupo5.sd.ufersa.dev.br`.
2. **Record name**: `api`
3. **Type**: `CNAME`
4. **Value**: O *API Gateway Domain Name* (`d-xxxxx.execute-api.us-east-1.amazonaws.com`), sem protocolos (`https://`) ou rotas (`/prod`).

---

## 5. Integração Final

Com a infraestrutura de DNS propagada, a URL customizada da API é inserida no script principal do jogo.

```javascript
// engine.js
const CONFIG = {
  // ... outras configs ...
  API_URL: "https://api.anderson.grupo5.sd.ufersa.dev.br/score"
};

// ... fluxo de Game Over ...
fetch(CONFIG.API_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    username: "Anderson",
    score: G.score
  })
});
```

### 5.1 Validação (Evidências)
No momento em que a condição de Game Over é atingida:
1. O frontend (`frogrun.anderson.grupo5.sd.ufersa.dev.br`) invoca um POST em background (`fetch`).
2. Através do **F12 → Network**, filtrando por **Fetch/XHR**.
3. O log de rede reporta sucesso:
   - **Status Code**: `200 OK`
   - **Request URL**: `https://api.anderson.grupo5.sd.ufersa.dev.br/score`
   - O CORS responde com acesso liberado.
   - O processo valida toda a stack de DNS Customizado, Integração de API Gateway e Proxy Lambda.
