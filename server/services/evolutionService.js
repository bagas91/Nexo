import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carrega variáveis de ambiente
dotenv.config({ path: path.join(__dirname, '../.env') });

const API_URL = process.env.EVOLUTION_API_URL;
const API_KEY = process.env.EVOLUTION_API_KEY;
const INSTANCE_NAME = process.env.EVOLUTION_INSTANCE_NAME || 'zapflow_saas';

class EvolutionService {
    constructor() {
        this.client = axios.create({
            baseURL: API_URL,
            headers: {
                'Content-Type': 'application/json',
                'apikey': API_KEY
            }
        });

        console.log(`[Evolution] 🔧 Configurado para: ${API_URL}`);
        console.log(`[Evolution] 📱 Instância alvo: ${INSTANCE_NAME}`);
    }

    /**
     * Verifica e cria a instância se não existir
     */
    async initialize() {
        try {
            console.log('[Evolution] 🔄 Verificando instância...');
            // Tenta buscar informações da instância
            await this.client.get(`/instance/fetchInstances?instanceName=${INSTANCE_NAME}`);
            console.log('[Evolution] ✅ Instância encontrada.');
        } catch (err) {
            if (err.response && err.response.status === 404) {
                console.log('[Evolution] ⚠️ Instância não encontrada. Criando...');
                await this.createInstance();
            } else {
                console.error('[Evolution] ❌ Erro ao verificar instância:', err.message);
            }
        }
    }

    async createInstance() {
        try {
            await this.client.post('/instance/create', {
                instanceName: INSTANCE_NAME,
                qrcode: true,
                integration: "WHATSAPP-BAILEYS"
            });
            console.log('[Evolution] ✅ Instância criada com sucesso!');
        } catch (err) {
            console.error('[Evolution] ❌ Erro ao criar instância:', err.response?.data || err.message);
        }
    }

    async connect() {
        try {
            const res = await this.client.get(`/instance/connect/${INSTANCE_NAME}`);
            return res.data;
        } catch (err) {
            console.error('[Evolution] Erro ao conectar:', err.message);
            return null;
        }
    }

    async getStatus() {
        try {
            // Nota: endpoint pode variar dependendo da versão da Evolution
            const res = await this.client.get(`/instance/connectionState/${INSTANCE_NAME}`);
            // Adapta resposta para o formato esperado pelo frontend
            const state = res.data?.instance?.state || 'DISCONNECTED';

            // Se estiver conectando, verificamos se tem QR Code disponível
            let qrCode = null;
            if (state === 'connecting') {
                qrCode = await this.getQR();
            }

            if (qrCode) {
                return {
                    ready: false,
                    authenticated: false,
                    status: 'QR_READY',
                    qr: qrCode
                };
            }

            return {
                ready: state === 'open',
                authenticated: state === 'open',
                status: state === 'open' ? 'CONNECTED' : (state === 'connecting' ? 'CONNECTING' : 'DISCONNECTED')
            };
        } catch (err) {
            return { ready: false, authenticated: false, status: 'DISCONNECTED' };
        }
    }

    async getQR() {
        try {
            // Busca o QR code (se a instância estiver aguardando conexão)
            const res = await this.client.get(`/instance/connect/${INSTANCE_NAME}`);

            // Evolution v2 pode retornar o base64 diretamente ou dentro de um objeto
            if (res.data && res.data.base64) {
                return res.data.base64;
            } else if (res.data && res.data.code) { // Algumas versões usam 'code'
                return res.data.code;
            } else if (typeof res.data === 'string' && res.data.startsWith('data:image')) {
                return res.data;
            }
            return null;
        } catch (err) {
            return null;
        }
    }

    async logout() {
        try {
            await this.client.delete(`/instance/logout/${INSTANCE_NAME}`);
            console.log('[Evolution] Desconectado');
        } catch (err) {
            console.error('[Evolution] Erro ao desconectar:', err.message);
        }
    }

    async getChats() {
        try {
            // Tenta buscar conversas (modificar conforme endpoint real da Evolution)
            const res = await this.client.get(`/chat/findContacts/${INSTANCE_NAME}`);
            // Mapeia para o formato esperado pelo frontend
            if (Array.isArray(res.data)) {
                return res.data.map(chat => ({
                    id: chat.id,
                    name: chat.name || chat.pushName || 'Desconhecido',
                    type: 'private', // Simplificação
                    members: 0
                }));
            }
            return [];
        } catch (err) {
            console.error('[Evolution] Erro ao buscar chats:', err.message);
            return [];
        }
    }

    async sendMessage(chatId, text) {
        try {
            await this.client.post(`/message/sendText/${INSTANCE_NAME}`, {
                number: chatId, // Evolution geralmente espera apenas o número ou ID completo
                options: {
                    delay: 1200,
                    presence: "composing"
                },
                textMessage: {
                    text: text
                }
            });
            return { success: true };
        } catch (err) {
            console.error('[Evolution] Erro ao enviar:', err.message);
            throw err;
        }
    }
}

export default new EvolutionService();
