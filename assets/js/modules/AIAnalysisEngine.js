export class AIAnalysisEngine {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.apiUrl = 'https://api.anthropic.com/v1/messages';
    }

    async callAnthropic(payload) {
        // Anthropic API does not allow browser CORS. Use Supabase Edge Function proxy.
        const { db } = await import('./supabase-client.js');
        const { data, error } = await db.functions.invoke('anthropic-proxy', {
            body: {
                apiKey: this.apiKey,
                payload
            }
        });

        if (error) {
            throw new Error(error.message || 'Proxy error');
        }

        const status = Number(data?.status || 0);
        const body = data?.body;
        if (!status) {
            throw new Error('Proxy response inválida');
        }
        if (status < 200 || status >= 300) {
            throw new Error(`API error: ${status}`);
        }
        return body;
    }

    async analyzePerformance(audioAnalysis, recordingMetadata = {}) {
        const prompt = this.buildAnalysisPrompt(audioAnalysis, recordingMetadata);

        try {
            const data = await this.callAnthropic({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 2000,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            });
            const analysis = this.parseAIResponse(data?.content?.[0]?.text || '');
            return analysis || this.getFallbackAnalysis(audioAnalysis);
        } catch (error) {
            console.error('Error calling AI API:', error);
            return this.getFallbackAnalysis(audioAnalysis);
        }
    }

    async answerQuestion(audioAnalysis, aiAnalysis, question) {
        const q = String(question || '').trim();
        if (!q) {
            return 'Escribe una pregunta para poder ayudarte.';
        }

        if (!this.apiKey) {
            return this.getFallbackAnswer(audioAnalysis, aiAnalysis, q);
        }

        const prompt = this.buildQuestionPrompt(audioAnalysis, aiAnalysis, q);

        try {
            const data = await this.callAnthropic({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 700,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            });
            const text = String(data?.content?.[0]?.text || '').trim();
            return text || this.getFallbackAnswer(audioAnalysis, aiAnalysis, q);
        } catch (error) {
            console.error('Error calling AI API (Q&A):', error);
            return this.getFallbackAnswer(audioAnalysis, aiAnalysis, q);
        }
    }

    buildAnalysisPrompt(audioAnalysis, metadata) {
        const tempo = audioAnalysis?.tempo || {};
        const key = audioAnalysis?.key || {};
        const loudness = audioAnalysis?.loudness || {};
        const mfcc = Array.isArray(audioAnalysis?.mfcc) ? audioAnalysis.mfcc : [];
        const spectralCentroid = Number(audioAnalysis?.spectralCentroid || 0);
        const rhythmicComplexity = Number(audioAnalysis?.rhythmicComplexity || 0);

        return `Eres un profesor experto de piano jazz y música afrocubana.
Recibes métricas de análisis de audio REALES y debes dar feedback constructivo.

MÉTRICAS REALES DEL AUDIO:
- Duración: ${Number(audioAnalysis?.duration || 0).toFixed(1)} segundos
- Tempo: ${Math.round(Number(tempo.bpm || 0))} BPM (confianza: ${(Number(tempo.confidence || 0) * 100).toFixed(0)}%)
- Tonalidad detectada: ${key.key || 'Desconocida'} ${key.scale || ''} (fuerza: ${(Number(key.strength || 0) * 100).toFixed(0)}%)
- Loudness promedio: ${Number(loudness.average || 0).toFixed(2)} dB
- Complejidad dinámica: ${Number(loudness.dynamicComplexity || 0).toFixed(2)} (0=plano, 1=muy dinámico)
- Centroide espectral: ${spectralCentroid.toFixed(0)} Hz
- Variabilidad rítmica: ${rhythmicComplexity.toFixed(2)}
- Coeficientes MFCC (timbre): ${mfcc.slice(0, 5).map(v => Number(v).toFixed(2)).join(', ')}

${metadata.style ? `Estilo musical: ${metadata.style}` : ''}
${metadata.notes ? `Notas del músico: ${metadata.notes}` : ''}

Responde estrictamente en JSON con esta estructura:
{
  "overallScore": número 1-10,
  "musicalAnalysis": "párrafo interpretando las métricas en términos musicales humanos",
  "positiveAspects": ["aspecto 1", "aspecto 2", "aspecto 3"],
  "areasToImprove": ["mejora 1", "mejora 2", "mejora 3"],
  "practiceSuggestions": [
    { "title": "...", "description": "..." },
    { "title": "...", "description": "..." }
  ]
}

Reglas:
- Interpreta las métricas en lenguaje musical real
- Si la complejidad dinámica es < 0.3, menciona que la interpretación suena plana
- Si la variabilidad rítmica > 0.4, menciona inconsistencia en el pulso
- Si la confianza del tempo es < 0.5, no hagas afirmaciones fuertes sobre el ritmo
- Responde SOLO con el JSON`;
    }

    buildQuestionPrompt(audioAnalysis, aiAnalysis, question) {
        const safeAi = aiAnalysis && typeof aiAnalysis === 'object' ? aiAnalysis : {};
        const positives = Array.isArray(safeAi.positiveAspects) ? safeAi.positiveAspects : [];
        const improve = Array.isArray(safeAi.areasToImprove) ? safeAi.areasToImprove : [];
        const suggestions = Array.isArray(safeAi.practiceSuggestions) ? safeAi.practiceSuggestions : [];
        const tempo = Number(audioAnalysis?.tempo?.bpm || audioAnalysis?.tempo || 0);
        const keyName = audioAnalysis?.key?.key || audioAnalysis?.pitch || 'Desconocida';
        const keyScale = audioAnalysis?.key?.scale || '';
        const loudnessAvg = Number(audioAnalysis?.loudness?.average || audioAnalysis?.loudness?.db || 0);
        const dynamic = Number(audioAnalysis?.loudness?.dynamicComplexity || 0);

        return `Eres un profesor experto de piano. Responde la pregunta del estudiante con claridad, pasos concretos y ejemplos.

IMPORTANTE: NO tienes acceso al audio. Solo a métricas numéricas y al análisis previo.

MÉTRICAS:
- Duración: ${audioAnalysis.duration.toFixed(1)}s
- Tempo detectado: ${tempo} BPM
- Tonalidad estimada: ${keyName} ${keyScale}
- Loudness promedio: ${loudnessAvg.toFixed(1)} dB
- Complejidad dinámica: ${dynamic.toFixed(2)}

ANÁLISIS PREVIO (resumen):
- Puntuación: ${safeAi.overallScore ?? 'N/A'}/10
- Positivos: ${positives.slice(0, 6).join(' | ')}
- Mejoras: ${improve.slice(0, 6).join(' | ')}
- Sugerencias: ${suggestions.slice(0, 6).map(s => s?.title).filter(Boolean).join(' | ')}

PREGUNTA DEL ESTUDIANTE:
${question}

Responde en español. Sé específico para pianistas (tempo, articulación, dinámica, coordinación manos, voicings).`;
    }

    getFallbackAnswer(audioAnalysis, aiAnalysis, question) {
        const q = String(question || '').toLowerCase();
        const tempo = Number(audioAnalysis?.tempo?.bpm || audioAnalysis?.tempo || 0);
        const level = Number(audioAnalysis?.loudness?.dynamicComplexity || 0);
        const score = aiAnalysis?.overallScore;

        if (q.includes('tempo') || q.includes('ritmo') || q.includes('metrónomo') || q.includes('metronomo')) {
            return `Sobre el tempo: te detecté aprox. ${tempo} BPM.\n\nPrueba esto:\n1) Metrónomo en negras a ${Math.round(tempo * 0.8)} BPM (80%) y toca sin parar 2 minutos.\n2) Sube a ${tempo} BPM y repite.\n3) Si te aceleras, cambia el metrónomo a corcheas (subdivide) por 1 minuto.\n\nSi me dices qué parte se te va (inicio/medio/final), te propongo un ejercicio más específico.`;
        }

        if (q.includes('dinam') || q.includes('volumen') || q.includes('fuerte') || q.includes('suave')) {
            const dynHint = level < 0.3
                ? 'La interpretación parece algo plana en dinámicas.'
                : 'Hay variación dinámica aprovechable.';
            return `Sobre dinámica/volumen: ${dynHint}\n\nEjercicio rápido:\n- Toca una misma frase 5 veces: pp, p, mf, f, ff.\n- Mantén el tempo fijo y cambia solo el peso del brazo y la velocidad del ataque.\n\nSi quieres, dime qué estilo estás tocando (blues/bebop/bolero/latin) y ajusto la sugerencia.`;
        }

        return `Puedo ayudarte con esa pregunta.\n\nCon lo que tengo (sin audio), sé que tu grabación dura ${audioAnalysis.duration?.toFixed?.(1) ?? 'N/A'}s, tempo aprox. ${tempo} BPM y score ${score ?? 'N/A'}/10.\n\nPara afinar la respuesta, dime:\n- ¿Qué estabas practicando (tema/lick/estilo)?\n- ¿Qué te salió mal exactamente (tempo, notas, coordinación, swing, voicings, mano izquierda)?`;
    }

    parseAIResponse(text) {
        try {
            const jsonMatch = String(text || '').match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            return JSON.parse(text);
        } catch (error) {
            console.error('Error parsing AI response:', error);
            return null;
        }
    }

    getFallbackAnalysis(audioAnalysis) {
        const tempoBpm = Number(audioAnalysis?.tempo?.bpm || audioAnalysis?.tempo || 0);
        const dynamic = Number(audioAnalysis?.loudness?.dynamicComplexity || 0);
        const loudnessFeedback = dynamic < 0.3
            ? 'La dinámica suena relativamente plana; conviene ampliar contrastes.'
            : 'Se aprecia una dinámica con cierto movimiento.';
        const tempoFeedback = this.getTempoFeedback(tempoBpm);

        return {
            overallScore: 7,
            musicalAnalysis: `Interpretación de ${audioAnalysis.duration.toFixed(1)} segundos. ${tempoFeedback} ${loudnessFeedback} La grabación muestra elementos técnicos sólidos con espacio para desarrollo expresivo.`,
            positiveAspects: [
                'Mantuviste un tempo relativamente estable durante la interpretación',
                'La claridad en la ejecución de las notas es evidente',
                'Hay control básico de la dinámica'
            ],
            areasToImprove: [
                'Trabajar en mayor variación dinámica para expresividad',
                'Explorar diferentes articulaciones y fraseos',
                'Desarrollar más confianza en el manejo del tempo'
            ],
            practiceSuggestions: [
                {
                    title: 'Practica con metrónomo',
                    description: `Tu tempo de ${tempoBpm} BPM es un buen punto de partida. Practica a diferentes velocidades: 80%, 100% y 120% de este tempo.`
                },
                {
                    title: 'Ejercicios de dinámica',
                    description: 'Toca la misma frase a diferentes volúmenes (pp, p, mf, f, ff) para desarrollar control dinámico.'
                },
                {
                    title: 'Graba y compara',
                    description: 'Graba la misma pieza múltiples veces y compara las interpretaciones para identificar áreas de mejora.'
                }
            ]
        };
    }

    getTempoFeedback(tempo) {
        if (tempo < 60) return 'El tempo es bastante lento, apropiado para baladas.';
        if (tempo < 90) return 'Tempo moderado, bueno para piezas expresivas.';
        if (tempo < 120) return 'Tempo medio, versátil para varios estilos.';
        if (tempo < 150) return 'Tempo animado, adecuado para piezas energéticas.';
        return 'Tempo rápido, desafiante para mantener precisión.';
    }

    getLoudnessFeedback(level) {
        const feedbacks = {
            'Muy fuerte': 'Nivel de volumen muy alto - considera más variación dinámica.',
            'Fuerte': 'Buen nivel de proyección sonora.',
            'Moderado': 'Nivel de volumen equilibrado.',
            'Suave': 'Nivel suave - considera usar más proyección en secciones climáticas.',
            'Muy suave': 'Nivel muy bajo - verifica tu técnica y la grabación.'
        };
        return feedbacks[level] || '';
    }
}
