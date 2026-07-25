import { Note } from '../models/note.model';

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function daysAgo(days: number): Date {
  return hoursAgo(days * 24);
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export const MOCK_NOTES: readonly Note[] = [
  {
    id: 'note-stripe-webhook',
    title: 'Payload webhook Stripe',
    language: 'json',
    source: 'API Gateway / Auth',
    tags: ['webhook', 'stripe'],
    pinned: true,
    createdAt: daysAgo(6),
    updatedAt: hoursAgo(1 / 15), // ~4 min
    lifecycle: { kind: 'permanent' },
    content: `{
  "id": "evt_1PqXyZ2eZvKYlo2C",
  "type": "invoice.payment_failed",
  "data": {
    "object": {
      "id": "in_1PqXy...",
      "amount_due": 4900,
      "attempt_count": 2,
      "currency": "eur"
    }
  }
}
// Notes: à rejouer contre le endpoint /webhooks/retry
// une fois le fix de idempotency key déployé`,
  },
  {
    id: 'note-use-debounce',
    title: 'Hook useDebounce réutilisable',
    language: 'js',
    source: 'Snippets perso',
    tags: ['hooks'],
    pinned: true,
    createdAt: daysAgo(12),
    updatedAt: hoursAgo(2),
    lifecycle: { kind: 'permanent' },
    content: `function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timeout);
  }, [value, delay]);

  return debounced;
}`,
  },
  {
    id: 'note-regex-uuid',
    title: 'Regex extraction UUID logs',
    language: 'txt',
    source: 'Logs prod',
    tags: ['regex'],
    pinned: false,
    createdAt: hoursAgo(1),
    updatedAt: hoursAgo(1),
    lifecycle: { kind: 'permanent' },
    content: String.raw`^\[(?<uuid>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]`,
  },
  {
    id: 'note-migration-ordering',
    title: 'fix_migration_ordering.py',
    language: 'py',
    source: 'Migration script',
    tags: ['django'],
    pinned: false,
    createdAt: hoursAgo(3),
    updatedAt: hoursAgo(3),
    lifecycle: { kind: 'permanent' },
    content: `def resolve_dependencies(migrations):
    graph = build_graph(migrations)
    return topo_sort(graph)`,
  },
  {
    id: 'note-slow-query',
    title: 'Query lenteur dashboard',
    language: 'sql',
    source: 'Dashboard interne',
    tags: ['sql'],
    pinned: false,
    createdAt: hoursAgo(5),
    updatedAt: hoursAgo(5),
    lifecycle: { kind: 'permanent' },
    content: `SELECT o.id, COUNT(li.id)
FROM orders o
JOIN line_items li ON li.order_id = o.id
GROUP BY o.id
ORDER BY COUNT(li.id) DESC;`,
  },
  {
    id: 'note-auth-todo',
    title: 'TODO refonte auth middleware',
    language: 'txt',
    source: 'Backlog / Auth',
    tags: ['auth'],
    pinned: false,
    createdAt: daysAgo(4),
    updatedAt: daysAgo(1),
    lifecycle: { kind: 'expires', at: daysFromNow(2) },
    content: `- [ ] gérer refresh token expiré
- [ ] logger tentatives échouées
- [ ] rate limit /login`,
  },
  {
    // Plus de 7 jours et non épinglée : alimente la section « Plus anciennes ».
    // Avant l'ajout de cette section, une telle note n'apparaissait nulle part.
    id: 'note-git-bisect',
    title: 'Aide-mémoire git bisect',
    language: 'txt',
    source: 'Snippets perso',
    tags: ['git'],
    pinned: false,
    createdAt: daysAgo(23),
    updatedAt: daysAgo(23),
    lifecycle: { kind: 'permanent' },
    content: `git bisect start
git bisect bad HEAD
git bisect good v1.4.0
# puis, à chaque étape : git bisect good | git bisect bad
git bisect reset`,
  },
  {
    id: 'note-docker-compose',
    title: 'docker-compose override local',
    language: 'yml',
    source: 'Config locale',
    tags: ['docker', 'config'],
    pinned: false,
    createdAt: daysAgo(5),
    updatedAt: daysAgo(2),
    lifecycle: { kind: 'expires', at: daysFromNow(1) },
    content: `services:
  api:
    environment:
      DEBUG=true`,
  },
];
