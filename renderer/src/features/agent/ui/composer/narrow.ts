/** How the composer's controls give ground as the pane narrows. The composer
 *  card is the `@container`, so these read the pane rather than the window.
 *
 *  At the narrow step the words a reader can do without go: the provider's
 *  name, the mode's name, the persona's name, Default's Tools label, and
 *  the model's name, so
 *  the model-and-thinking control reads as its level alone; while no level is
 *  known yet the name stays instead. At the narrowest step the level goes
 *  too and every trigger is an icon; a hover tooltip still names each
 *  trigger's selection. */
export const NARROW_LABEL = '@max-[34rem]:hidden';
export const NARROW_TRIGGER = '@max-[34rem]:px-1.5';
export const NARROWEST_LABEL = '@max-[24rem]:hidden';
export const NARROWEST_TRIGGER = '@max-[24rem]:px-1.5';
