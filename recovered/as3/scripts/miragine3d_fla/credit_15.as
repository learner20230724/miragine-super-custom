package miragine3d_fla
{
   import flash.display.MovieClip;
   import flash.display.SimpleButton;
   
   [Embed(source="/_assets/assets.swf", symbol="symbol74")]
   public dynamic class credit_15 extends MovieClip
   {
      
      public var back:SimpleButton;
      
      public function credit_15()
      {
         super();
         addFrameScript(0,this.frame1);
      }
      
      public function onClick(param1:*) : *
      {
         this.visible = false;
      }
      
      internal function frame1() : *
      {
         this.back.addEventListener("click",this.onClick);
      }
   }
}

