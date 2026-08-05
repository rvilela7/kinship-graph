require('dotenv').config(); // 1. O módulo dotenv é carregado na primeira linha para ler o ficheiro .env

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const { Pool } = require('pg');

const fastify = Fastify({ logger: true });

// 2. O plugin de CORS é registado para autorizar pedidos do Firebase, do domínio próprio e do ambiente local
fastify.register(cors, {
  origin: [
    'https://project-7ac65c12-8fa7-49e2-b5f.web.app',
    'https://project-7ac65c12-8fa7-49e2-b5f.firebaseapp.com',
    'https://vilelaeline.duckdns.org',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'OPTIONS']
});

// 3. O pool de conexões é configurado utilizando exclusivamente variáveis de ambiente
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'kinship_db',
  port: process.env.DB_PORT || 5432,
});

fastify.get('/api/family/:id', async (request, reply) => {
  const { id } = request.params;

  try {
    const query = `
      -- 1. Seleciona a pessoa consultada
      SELECT 
        id, full_name AS label, father_id, mother_id, birth_year, 'origem' AS relacao
      FROM persons
      WHERE id = $1
      UNION ALL

      -- 2. Seleciona os pais da pessoa consultada
      SELECT 
        id, full_name AS label, father_id, mother_id, birth_year, 'parent' AS relacao
      FROM persons
      WHERE id IN (
        SELECT father_id FROM persons WHERE id = $1 AND father_id IS NOT NULL
        UNION
        SELECT mother_id FROM persons WHERE id = $1 AND mother_id IS NOT NULL
      )

      UNION ALL

      -- 3. Seleciona os filhos da pessoa consultada
      SELECT 
        id, full_name AS label, father_id, mother_id, birth_year, 'child' AS relacao
      FROM persons
      WHERE father_id = $1 OR mother_id = $1;
    `;

    const result = await pool.query(query, [id]);

    const nodes = [];
    const edges = [];

    const origemRow = result.rows.find(r => r.id === id);

    result.rows.forEach(row => {
      const labelComAno = row.birth_year 
        ? `${row.label} (${row.birth_year})` 
        : row.label;

      if (!nodes.some(n => n.id === row.id)) {
        nodes.push({ id: row.id, label: labelComAno });
      }

      // 1. Se o registo corresponder à pessoa de origem, associa-a aos respetivos pais
      if (row.id === id) {
        if (row.father_id) {
          edges.push({ from: row.father_id, to: row.id, label: 'pai' });
        }
        if (row.mother_id) {
          edges.push({ from: row.mother_id, to: row.id, label: 'mãe' });
        }
      }

      // 2. Se o registo for um progenitor obtido, associa esse progenitor à pessoa consultada
      if (row.relacao === 'parent') {
        if (origemRow && origemRow.father_id === row.id) {
          edges.push({ from: row.id, to: id, label: 'pai' });
        }
        if (origemRow && origemRow.mother_id === row.id) {
          edges.push({ from: row.id, to: id, label: 'mãe' });
        }
      }

      // 3. Se o registo for um filho obtido, estabelece a ligação do progenitor para o filho
      if (row.relacao === 'child') {
        if (row.father_id === id) {
          edges.push({ from: id, to: row.id, label: 'pai' });
        } else if (row.mother_id === id) {
          edges.push({ from: id, to: row.id, label: 'mãe' });
        }
      }
    });

    return { nodes, edges };
  } catch (err) {
    request.log.error(err);
    reply.status(500).send({ error: 'Erro ao consultar a base de dados' });
  }
});

// O servidor é inicializado na porta 3000
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('API do kinship-graph a rodar na porta 3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();