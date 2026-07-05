# API Backend – Rotas e uso no frontend

Referência rápida das rotas do backend (porta 3001) e onde são usadas no frontend.

| Rota | Método | Uso no frontend |
|------|--------|------------------|
| `/api/login` | POST | Login |
| `/api/status` | GET | Status/QR/Conexão (polling) |
| `/api/qr` | GET | Tela de conexão (QR Code) |
| `/api/disconnect` | POST | Header – Desconectar |
| `/api/reconnect` | POST | Header – Reconectar |
| `/api/chats` | GET | Carregamento inicial de chats |
| `/api/chats/paginated` | GET | Lista paginada (Grupos e Canais) |
| `/api/chats/refresh` | POST | Botão “Atualizar lista” (Grupos) |
| `/api/chats/invalid-groups` | GET | Grupos inválidos (Grupos) |
| `/api/chats/remove-group-usages` | POST | Remover grupo de categorias/agendamentos (Grupos) |
| `/api/categories` | GET, POST, PUT, DELETE | Categorias |
| `/api/schedules` | GET, POST | Agendamentos (listagem + criar) |
| `/api/schedules/:id` | PUT, DELETE | Dashboard – pausar, reativar, excluir |
| `/api/dispatches` | GET, POST | Log de disparos + registro ao agendar |
| `/api/history` | GET | Histórico de envios |
| `/api/history/clear` | POST | Histórico – Limpar tudo |
| `/api/history/today-count` | GET | Dashboard – “Mensagens Hoje” |
| `/api/send` | POST | Envio único (se usado) |
| `/api/send-bulk` | POST | Envio em massa / worker de agendamentos |
| `/api/health` | GET | Health check externo |

Views principais: **Login**, **Dashboard**, **Grupos e Canais** (ChatList), **Agendamentos** (Scheduler), **Categorias**, **Log de disparos** (DispatchesView), **Histórico** (HistoryView), **Configurações** (sem persistência por enquanto).
