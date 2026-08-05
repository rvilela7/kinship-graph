
require('dotenv').config(); // 1. Carrega o dotenv logo na PRIMEIRA linha para ler o ficheiro .env

const Fastify = require('fastify');
const { Pool } = require('pg');

const fastify = Fastify({ logger: true });


const pool = new Pool({ // 2. Configura a Pool usando APENAS variáveis de ambiente
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD, // NUNCA colocar a senha real aqui!
  database: process.env.DB_NAME || 'kinship_db',
  port: process.env.DB_PORT || 5432,
});

fastify.get('/api/family/:id', async (request, reply) => {
  const { id } = request.params;

  try {
    const query = `
      -- 1. A pessoa consultada
      SELECT 
        id, full_name AS label, father_id, mother_id, birth_year, 'origem' AS relacao
      FROM persons
      WHERE id = $1
      UNION ALL

      -- 2. Os pais da pessoa consultada
      SELECT 
        id, full_name AS label, father_id, mother_id, birth_year, 'parent' AS relacao
      FROM persons
      WHERE id IN (
        SELECT father_id FROM persons WHERE id = $1 AND father_id IS NOT NULL
        UNION
        SELECT mother_id FROM persons WHERE id = $1 AND mother_id IS NOT NULL
      )

      UNION ALL

      -- 3. Os filhos da pessoa consultada
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

      // 1. Se for a pessoa de origem: liga aos seus pais
      if (row.id === id) {
        if (row.father_id) {
          edges.push({ from: row.father_id, to: row.id, label: 'pai' });
        }
        if (row.mother_id) {
          edges.push({ from: row.mother_id, to: row.id, label: 'mãe' });
        }
      }

      // 2. Se for um pai/mãe obtido: liga desse progenitor para a pessoa consultada
      if (row.relacao === 'parent') {
        if (origemRow && origemRow.father_id === row.id) {
          edges.push({ from: row.id, to: id, label: 'pai' });
        }
        if (origemRow && origemRow.mother_id === row.id) {
          edges.push({ from: row.id, to: id, label: 'mãe' });
        }
      }

      // 3. Se for um filho obtido: liga SEMPRE do progenitor (que pode ser pai ou mãe) para o filho
      if (row.relacao === 'child') {
        if (row.father_id === id) {
          // O nó consultado (id) é o PAI do filho (row.id)
          edges.push({ from: id, to: row.id, label: 'pai' });
        } else if (row.mother_id === id) {
          // O nó consultado (id) é a MÃE do filho (row.id)
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

// Arrancar o servidor na porta 3000
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