import type { User } from '@/entities/user';

export const MOCK_USERS: User[] = [
    { id: 1, name: 'Leanne Graham', username: 'Bret', email: 'sincere@april.biz', phone: '1-770-736-8031' },
    { id: 2, name: 'Ervin Howell', username: 'Antonette', email: 'shanna@melissa.tv', phone: '010-692-6593' },
    { id: 3, name: 'Clementine Bauch', username: 'Samantha', email: 'nathan@yesenia.net', phone: '1-463-123-4447' },
];

export function findUserByEmail(email: string): User | undefined {
    const normalizedEmail = email.toLowerCase();

    return MOCK_USERS.find((user) => user.email.toLowerCase() === normalizedEmail);
}