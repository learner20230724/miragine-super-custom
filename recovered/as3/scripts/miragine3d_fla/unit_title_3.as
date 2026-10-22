package miragine3d_fla
{
   import flash.display.MovieClip;
   import flash.display.SimpleButton;
   
   [Embed(source="/_assets/assets.swf", symbol="symbol75")]
   public dynamic class unit_title_3 extends MovieClip
   {
      
      public var bn_loading:SimpleButton;
      
      public var bn_btns:MovieClip;
      
      public var credit:MovieClip;
      
      public function unit_title_3()
      {
         super();
         addFrameScript(0,this.frame1);
      }
      
      internal function frame1() : *
      {
         this.credit.visible = false;
      }
   }
}

