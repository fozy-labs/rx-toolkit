export const fetches = {
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
    }
}
