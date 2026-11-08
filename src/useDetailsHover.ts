import { useEffect, useRef, useState } from 'react';

export function useDetailsHover() {
    const [hovered, setHovered] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const cancel = () => {
        clearTimeout(timer.current);
        timer.current = undefined;
    };
    useEffect(() => () => clearTimeout(timer.current), []);
    return {
        'data-hovered': hovered,
        onPointerEnter: () => {
            cancel();
            if (matchMedia('(hover: hover)').matches) timer.current = setTimeout(() => setHovered(true), 1000);
        },
        onPointerLeave: () => {
            cancel();
            setHovered(false);
        },
    };
}
