```tsx
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTRPC } from '../utils/trpc';
export default function UserList() {
  const trpc = useTRPC(); // use `import { trpc } from './utils/trpc'` if you're using the singleton pattern
  const userQuery = useQuery(trpc.getUser.queryOptions({ id: 'id_bilbo' }));
  const userCreator = useMutation(trpc.createUser.mutationOptions());
  return (
    <div>
      <p>{userQuery.data?.name}</p>
      <button onClick={() => userCreator.mutate({ name: 'Frodo' })}>
        Create Frodo
      </button>
    </div>
  );
}
```

also see:
- https://trpc.io/docs/client/tanstack-react-query/setup
- https://trpc.io/docs/client/tanstack-react-query/usage