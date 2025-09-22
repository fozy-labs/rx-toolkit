import {Batcher, Computed, Effect, Signal} from "../dist";

export const runSignalsExample = () => {
    console.log('Running signals example...');

    const between = (start, end) => {
        return Math.floor(Math.random() * (end - start + 1)) + start;
    }

    const distance$ = new Signal(0);
    const time$ = new Signal(0);

    let updateCount = 0;

    const averageSpeed$ = new Computed(() => {
        return Math.round((distance$.value / time$.value) * 3.6);
    });

    let index$ = new Computed(() => {
        const speed = averageSpeed$.value;
        if (speed < 20) {
            return 'slow';
        }
        if (speed < 50) {
            return 'average';
        }
        if (speed < 100) {
            return 'fast';
        }
        if (speed < 200) {
            return 'very fast';
        }
        return 'extremely fast';
    });

    const effect = new Effect(() => {
        console.group('Machine stats:');
        console.log('Running time, min', time$.value / 60);
        console.log('Average speed, km/h', averageSpeed$.value);
        console.log('Speed index', index$.value);
        console.log('Distance, km', distance$.value / 1000);
        console.log('Update count', updateCount);
        console.groupEnd();
    });

    const i = setInterval(() => {
        updateCount++;
        const distance = between(0, 100);

        Batcher.batch(() => {
            distance$.value += distance;
            time$.value++;
        });
    }, 100)


    setTimeout(() => {
        console.log('Effect unsubscribed');
        effect.unsubscribe();
        clearInterval(i);
    }, 400)
}

runSignalsExample();
