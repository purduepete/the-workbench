import { useState } from 'react';
import { X } from 'lucide-react';

/** Closes the dialog; with unsaved text, the first press asks to confirm and the second discards. */
export function DialogCloseButton({ onClose, isProtected }: { onClose: () => void; isProtected?: () => boolean }) {
    const [confirming, setConfirming] = useState(false);
    return (
        <button
            type="button"
            className="icon-button dialog-close"
            data-confirming={confirming}
            aria-label={confirming ? 'Discard changes' : 'Close'}
            onBlur={() => setConfirming(false)}
            onClick={() => {
                if (!confirming && isProtected?.()) {
                    setConfirming(true);
                    return;
                }
                onClose();
            }}
        >
            <X size={17} aria-hidden="true" />
            {confirming && <span>Discard</span>}
        </button>
    );
}
