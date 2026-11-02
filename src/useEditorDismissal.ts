import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';

export function useEditorDismissal(
    dialogRef: RefObject<HTMLDialogElement | null>,
    initiallyProtected: boolean,
    onProtectionChange: (protectedDraft: boolean) => void
) {
    const [protectedDraft, setProtectedDraftState] = useState(initiallyProtected);
    const protectedRef = useRef(initiallyProtected);
    const setProtectedDraft = useCallback(
        (value: boolean) => {
            protectedRef.current = value;
            setProtectedDraftState(value);
            onProtectionChange(value);
        },
        [onProtectionChange]
    );

    useEffect(() => {
        dialogRef.current?.setAttribute('closedby', 'none');
        onProtectionChange(protectedRef.current);
        return () => onProtectionChange(false);
    }, [dialogRef, onProtectionChange]);

    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDialogElement>) => {
        if (event.key === 'Escape' && protectedRef.current) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, []);

    return {
        protectedDraft,
        setProtectedDraft,
        onKeyDown,
        isProtected: () => protectedRef.current,
    };
}
