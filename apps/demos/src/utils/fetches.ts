
export const fetches = {
    getItems: async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return {
            items: [
                { id: 1, name: 'Задача 1', description: 'Реализовать новую функцию' },
                { id: 2, name: 'Задача 2', description: 'Исправить баги в коде' },
                { id: 3, name: 'Задача 3', description: 'Написать документацию' },
                { id: 4, name: 'Задача 4', description: 'Провести код-ревью' },
                { id: 5, name: 'Задача 5', description: 'Оптимизировать производительность' }
            ],
        };
    },
    getCart: async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return {
            items: [
                { id: 1, name: 'Ноутбук', price: 50000, enabled: true },
                { id: 2, name: 'Мышь', price: 1500, enabled: false },
                { id: 3, name: 'Клавиатура', price: 3000, enabled: true },
                { id: 4, name: 'Монитор', price: 20000, enabled: false }
            ],
        };
    },
    toggleCartItem: async (args: { id: number; enabled: boolean }) => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return { id: args.id, enabled: args.enabled };
    },
    getUser: async (userId: number) => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const users = [
            { id: 1, name: 'Алексей Иванов', email: 'alexey@example.com', role: 'Разработчик', avatar: '👨‍💻' },
            { id: 2, name: 'Мария Петрова', email: 'maria@example.com', role: 'Дизайнер', avatar: '👩‍🎨' },
            { id: 3, name: 'Иван Сидоров', email: 'ivan@example.com', role: 'Менеджер', avatar: '👨‍💼' },
            { id: 4, name: 'Елена Кузнецова', email: 'elena@example.com', role: 'Аналитик', avatar: '👩‍💼' },
            { id: 5, name: 'Дмитрий Смирнов', email: 'dmitry@example.com', role: 'Тестировщик', avatar: '👨‍🔬' },
        ];
        return users.find(user => user.id === userId) || null;
    },
    getUserStats: async (args: { userId: number; period: string }): Promise<{ commits: number; pullRequests: number; reviews: number }> => {
        await new Promise(resolve => setTimeout(resolve, 800));
        const userStats = {
            1: { daily: [12, 3, 5], weekly: [67, 15, 28], monthly: [234, 48, 112] },
            2: { daily: [8, 2, 4], weekly: [45, 10, 20], monthly: [180, 35, 90] },
            3: { daily: [5, 1, 2], weekly: [30, 5, 12], monthly: [120, 20, 50] },
            4: { daily: [10, 4, 6], weekly: [55, 12, 25], monthly: [200, 40, 100] },
            5: { daily: [7, 2, 3], weekly: [40, 8, 15], monthly: [150, 30, 70] },
        };
        // @ts-ignore
        const stats = userStats[args.userId][args.period];
        return {
            commits: stats[0],
            pullRequests: stats[1],
            reviews: stats[2],
        }
    }
}
