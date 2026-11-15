<script>
	import { Toaster as Sonner } from "svelte-sonner";
	import { HugeiconsIcon } from "@hugeicons/svelte"
	import { Loading03Icon } from '@hugeicons/core-free-icons';
	import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons';
	import { MultiplicationSignCircleIcon } from '@hugeicons/core-free-icons';
	import { InformationCircleIcon } from '@hugeicons/core-free-icons';
	import { Alert02Icon } from '@hugeicons/core-free-icons';

	let { ...restProps } = $props();
</script>

<Sonner
	theme="dark"
	class="toaster group"
	toastOptions={{
		classes: {
			toast: "cn-toast",
		},
	}}
	{...restProps}
>
	{#snippet loadingIcon()}
		<HugeiconsIcon icon={Loading03Icon} strokeWidth={2} class="size-4 animate-spin" />
	{/snippet}
	{#snippet successIcon()}
		<HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} class="size-4" />
	{/snippet}
	{#snippet errorIcon()}
		<HugeiconsIcon icon={MultiplicationSignCircleIcon} strokeWidth={2} class="size-4" />
	{/snippet}
	{#snippet infoIcon()}
		<HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} class="size-4" />
	{/snippet}
	{#snippet warningIcon()}
		<HugeiconsIcon icon={Alert02Icon} strokeWidth={2} class="size-4" />
	{/snippet}
</Sonner>