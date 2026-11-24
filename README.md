# 🛡️ Aegis AdBlock

**Bloqueador de anúncios, rastreadores e elementos indesejados para Mozilla Firefox.**

O Aegis AdBlock é uma extensão de navegador desenvolvida para oferecer proteção durante a navegação, permitindo bloquear anúncios, rastreadores, domínios maliciosos e elementos visuais indesejados.

Com um painel de gerenciamento próprio, o usuário pode administrar listas de filtros, criar regras personalizadas, consultar estatísticas e controlar quais sites podem ou não carregar determinados recursos.

O projeto prioriza o processamento local e a privacidade: as configurações e os dados de navegação são armazenados no próprio dispositivo.

---

## ✨ Funcionalidades

### 🛡️ Proteção e bloqueio

- Bloqueio de anúncios e publicidade.
- Bloqueio de rastreadores e ferramentas de análise.
- Proteção contra domínios associados a malware e golpes.
- Bloqueio de elementos visuais indesejados.
- Filtros cosméticos para ocultar elementos das páginas.
- Suporte a exceções de regras.
- Controle geral para ativar ou desativar a proteção.

### 📋 Gerenciamento de listas

- Lista inicial integrada à extensão.
- Adição de listas por URL.
- Importação de listas por arquivo.
- Adição de regras manualmente.
- Atualização manual das listas.
- Atualização automática configurável.
- Catálogo de listas recomendadas.
- Organização das listas por categoria.
- Informações sobre regras inválidas e não suportadas.

### ⚙️ Regras personalizadas

- Criação de regras próprias.
- Gerenciamento de regras individuais.
- Lista de bloqueio personalizada.
- Gerenciamento de sites permitidos.
- Filtros cosméticos personalizados.
- Controle de exceções.

### 📊 Painel e estatísticas

- Painel com visão geral da proteção.
- Quantidade de recursos bloqueados.
- Estatísticas por categoria.
- Sites com maior quantidade de bloqueios.
- Gráficos de atividade.
- Histórico detalhado de bloqueios.
- Filtros e pesquisa no histórico.
- Exportação do histórico em CSV.

### 💾 Gerenciamento de dados

- Armazenamento local.
- Exportação das configurações.
- Importação das configurações.
- Exportação de backup completo.
- Restauração de dados.
- Limpeza do histórico.
- Configuração de retenção do histórico.
- Limpeza automática de eventos antigos.

---

## 🔒 Privacidade

A privacidade é um dos princípios do Aegis AdBlock.

- Configurações armazenadas localmente.
- Histórico de bloqueios armazenado no dispositivo.
- Estatísticas processadas localmente.
- Nenhuma conta de usuário necessária.
- Nenhum servidor próprio de coleta de dados é necessário para o funcionamento da extensão.
- Não exige cadastro ou autenticação externa.

**Importante:** listas adicionadas por URL precisam acessar seus respectivos servidores para baixar atualizações. Isso não significa que o histórico de navegação seja enviado a esses provedores.

O uso de listas externas também depende da disponibilidade e das políticas de seus respectivos mantenedores.

---

## 🦊 Compatibilidade

| Informação | Requisito |
|---|---|
| Navegador | Mozilla Firefox |
| Versão mínima declarada | Firefox 142 |
| Manifest | Manifest V3 |
| Plataforma | Windows e Linux |
| Arquitetura | Compatível com sistemas suportados pelo Firefox |

---

## 📥 Instalação

### Instalação para testes

1. Baixe ou extraia os arquivos do projeto.
2. Abra o Firefox.
3. Acesse `about:debugging`.
4. Entre em **Este Firefox**.
5. Clique em **Carregar extensão temporária**.
6. Selecione o arquivo `manifest.json` da extensão.

A extensão será carregada para testes.

**Observação:** extensões carregadas dessa maneira são temporárias e podem precisar ser carregadas novamente após reiniciar o navegador.

### Instalação permanente

Para distribuição permanente no Firefox, a extensão precisa passar pelo processo de assinatura do Mozilla Add-ons.

É possível publicar como extensão não listada, sem necessariamente disponibilizá-la publicamente na loja.

---

## 📚 Listas de filtros

O Aegis AdBlock possui suporte a fontes externas e listas recomendadas.

Entre as fontes disponíveis:

| Lista | Finalidade |
|---|---|
| EasyList | Bloqueio de anúncios |
| EasyPrivacy | Proteção contra rastreamento |
| EasyList Portuguese | Filtros para conteúdo em português |
| Fanboy's Annoyance | Elementos intrusivos |
| AdGuard Base Filter | Bloqueio geral de anúncios |
| AdGuard Tracking Protection | Bloqueio de rastreadores |
| StevenBlack Hosts | Bloqueio de domínios |
| HaGeZi Pro | Proteção ampliada |
| HaGeZi TIF | Ameaças e domínios maliciosos |
| URLhaus | Domínios associados a malware |
| uBlock Origin Privacy | Proteção contra rastreamento |

As listas são opcionais e podem ser administradas pelo painel.

---

## ⚠️ Limitações

- Nem todas as opções da sintaxe EasyList são suportadas.
- Algumas regras podem ser identificadas como inválidas ou incompatíveis.
- O bloqueio de elementos cosméticos depende dos seletores disponíveis e das regras utilizadas.
- Algumas páginas podem apresentar problemas quando filtros muito agressivos são ativados.
- A eficácia da proteção depende das listas instaladas e de sua atualização.
- O bloqueio de anúncios não garante a remoção de toda publicidade, especialmente quando integrada diretamente ao conteúdo.

---

## 🧰 Tecnologias

- HTML5
- CSS3
- JavaScript
- Firefox WebExtensions API
- Manifest V3
- IndexedDB
- Browser Storage API

Não depende de um servidor próprio para executar o mecanismo principal de proteção.

---

## 📁 Estrutura do projeto

```text
Aegis-AdBlock/
│
├── assets/
│   └── lists/
│       └── starter.txt
│
├── background/
│   └── index.js
│
├── blocked/
│   ├── blocked.css
│   ├── blocked.html
│   └── blocked.js
│
├── content/
│   └── content.js
│
├── dashboard/
│   ├── dashboard.html
│   └── app.js
│
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
│
├── popup/
│   ├── popup.css
│   ├── popup.html
│   └── popup.js
│
├── ui/
│   └── styles.css
│
└── manifest.json
```

---

## 📄 Versão

- **Projeto:** Aegis AdBlock
- **Versão:** 1.0.1
- **Plataforma principal:** Mozilla Firefox
- **Licença:** Não especificada nesta distribuição.

---

## 🤝 Contribuições

Contribuições são bem-vindas.

Sugestões, identificação de problemas, melhorias de desempenho, correções e novas funcionalidades podem ajudar na evolução do projeto.

Ao contribuir, procure manter a compatibilidade com o Firefox e preservar os princípios de privacidade e processamento local.

---

**Aegis AdBlock — Sua navegação, suas regras, sua privacidade.**
